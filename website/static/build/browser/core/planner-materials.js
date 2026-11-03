(() => {
    const formatter = new Intl.NumberFormat("en-GB", {
        notation: "compact",
        maximumFractionDigits: 1,
    });
    window.CyrenePlannerMaterials = {
        compact: (value) => formatter.format(value),
        craftingPlan(items, inventory) {
            const requirements = new Map(items.map((item) => [String(item.id), Number(item.amount)]));
            const families = new Map();
            items.forEach((item) => {
                if (!Array.isArray(item.crafting_lower))
                    return;
                const family = [...item.crafting_lower, { id: item.id }];
                const key = String(family[0]?.id ?? item.id);
                if (!families.has(key) || family.length > families.get(key).length)
                    families.set(key, family);
            });
            const plan = new Map();
            const held = (id) => Number(inventory.get(id)) || 0;
            families.forEach((family) => {
                const amounts = Array(family.length).fill(0);
                for (let index = family.length - 1; index > 0; index--) {
                    const id = String(family[index].id);
                    const consumedAbove = index < family.length - 1 ? amounts[index + 1] * 3 : 0;
                    amounts[index] = Math.max(0, (requirements.get(id) || 0) + consumedAbove - held(id));
                }
                let craftedFromLower = 0;
                family.forEach((material, index) => {
                    const id = String(material.id);
                    const before = held(id);
                    const available = before + craftedFromLower;
                    const required = requirements.get(id) || 0;
                    const upward = index < family.length - 1
                        ? Math.min(amounts[index + 1], Math.floor(Math.max(0, available - required) / 3))
                        : 0;
                    const after = available - upward * 3;
                    plan.set(id, {
                        before,
                        after,
                        enough: after >= required,
                        enoughBeforeCrafting: before >= required,
                    });
                    craftedFromLower = upward;
                });
            });
            return plan;
        },
    };
})();
