import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Exercise the production persistence functions without the editor's UI dependencies.
const source = fs.readFileSync(
    "website/src/browser/pages/characters/characters-planner.ts",
    "utf8",
);
const functions = source.slice(
    source.indexOf("    function loadPlans()"),
    source.indexOf("    function getPlan("),
);
const plan = (id) => ({ id, name: `Character ${id}`, icon: "/icon.png" });
function harness({ local = [], pending = false, server = [], fail = false } = {}) {
    const storage = new Map([
        ["plans", JSON.stringify(local)],
        ["cyrene-character-plans", JSON.stringify([plan(999)])],
    ]);
    if (pending) storage.set("plans-pending", "true");
    const writes = [];
    const context = vm.createContext({
        console: { error() {}, warn() {} },
        localStorage: {
            getItem: (key) => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, value),
            removeItem: (key) => storage.delete(key),
        },
        fetch: async (_url, options) => {
            if (options.method === "PUT") {
                writes.push(JSON.parse(options.body).plans);
                return { ok: !fail };
            }
            return { ok: true, json: async () => ({ plans: server }) };
        },
    });
    vm.runInContext(
        `const STORAGE_KEY = 'plans', pendingKey = 'plans-pending', accountId = '66';
        let plansRevision = 0, databaseSavePromise = Promise.resolve();
        const syncStatus = {};
        function renderPlans() {}
        ${functions}
        let plans = loadPlans();
        globalThis.api = {hydratePlansFromDatabase, persistPlans,
            setPlans: value => {plans = value}, getPlans: () => plans,
            wait: () => databaseSavePromise};`,
        context,
    );
    return { api: context.api, storage, writes };
}
test("an empty server never imports deleted legacy characters", async () => {
    const { api, writes } = harness();
    await api.hydratePlansFromDatabase();
    assert.equal(api.getPlans().length, 0);
    assert.equal(writes.length, 0);
});
test("a pending deletion replaces stale server plans with an empty snapshot", async () => {
    const { api, storage, writes } = harness({ pending: true, server: [plan(1)] });
    await api.hydratePlansFromDatabase();
    assert.deepEqual(writes, [[]]);
    assert.equal(api.getPlans().length, 0);
    assert.equal(storage.has("plans-pending"), false);
});
test("an unsaved new character survives reopening and retries", async () => {
    const { api, storage, writes } = harness({
        local: [plan(2)],
        pending: true,
        server: [plan(1)],
    });
    await api.hydratePlansFromDatabase();
    assert.equal(api.getPlans()[0].id, 2);
    assert.equal(writes[0][0].id, 2);
    assert.equal(storage.has("plans-pending"), false);
});
test("failed saves keep their pending marker and snapshot", async () => {
    const { api, storage } = harness({ fail: true });
    api.setPlans([plan(3)]);
    assert.equal(api.persistPlans(), true);
    await assert.rejects(api.wait());
    assert.equal(storage.get("plans-pending"), "true");
    assert.equal(JSON.parse(storage.get("plans"))[0].id, 3);
});
test("a clean server snapshot supersedes stale browser cache", async () => {
    const { api } = harness({ local: [plan(1)], server: [plan(2)] });
    await api.hydratePlansFromDatabase();
    assert.equal(api.getPlans()[0].id, 2);
});
