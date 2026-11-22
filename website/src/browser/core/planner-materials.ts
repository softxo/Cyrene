type MaterialId = string | number;

interface PlannerMaterial {
    id: MaterialId;
    amount: number;
    crafting_lower?: { id: MaterialId }[];
}

interface MaterialPlan {
    before: number;
    after: number;
    enough: boolean;
    enoughBeforeCrafting: boolean;
}

interface Window {
    CyrenePlannerMaterials: {
        compact: (value: number) => string;
        craftingPlan: (
            items: PlannerMaterial[],
            inventory: Map<string, number>,
        ) => Map<string, MaterialPlan>;
    };
}

(() => {
    const CRAFTING_RATIO = 3;

    const compactFormatter = new Intl.NumberFormat("en-GB", {
        notation: "compact",
        maximumFractionDigits: 1,
    });

    function collectRequirements(items: PlannerMaterial[]): Map<string, number> {
        return new Map(items.map((item) => [String(item.id), Number(item.amount)]));
    }

    function collectFamilies(items: PlannerMaterial[]): Map<string, { id: MaterialId }[]> {
        const families = new Map<string, { id: MaterialId }[]>();

        for (const item of items) {
            if (!Array.isArray(item.crafting_lower)) continue;

            const family = [...item.crafting_lower, { id: item.id }];
            const familyKey = String(family[0]?.id ?? item.id);
            const knownFamily = families.get(familyKey);

            if (!knownFamily || family.length > knownFamily.length) {
                families.set(familyKey, family);
            }
        }

        return families;
    }

    function planFamily(
        family: { id: MaterialId }[],
        requirements: Map<string, number>,
        heldAmount: (id: string) => number,
        plan: Map<string, MaterialPlan>,
    ): void {
        const lastIndex = family.length - 1;
        const craftsNeeded: number[] = Array(family.length).fill(0);

        for (let index = lastIndex; index > 0; index--) {
            const id = String(family[index].id);
            const consumedByTierAbove =
                index < lastIndex ? craftsNeeded[index + 1] * CRAFTING_RATIO : 0;
            const shortfall = (requirements.get(id) || 0) + consumedByTierAbove - heldAmount(id);

            craftsNeeded[index] = Math.max(0, shortfall);
        }

        let craftedFromLowerTier = 0;

        family.forEach((material, index) => {
            const id = String(material.id);
            const before = heldAmount(id);
            const available = before + craftedFromLowerTier;
            const required = requirements.get(id) || 0;

            let craftedUpward = 0;

            if (index < lastIndex) {
                const spare = Math.max(0, available - required);
                craftedUpward = Math.min(
                    craftsNeeded[index + 1],
                    Math.floor(spare / CRAFTING_RATIO),
                );
            }

            const after = available - craftedUpward * CRAFTING_RATIO;

            plan.set(id, {
                before,
                after,
                enough: after >= required,
                enoughBeforeCrafting: before >= required,
            });

            craftedFromLowerTier = craftedUpward;
        });
    }

    function craftingPlan(
        items: PlannerMaterial[],
        inventory: Map<string, number>,
    ): Map<string, MaterialPlan> {
        const requirements = collectRequirements(items);
        const families = collectFamilies(items);
        const plan = new Map<string, MaterialPlan>();

        const heldAmount = (id: string) => Number(inventory.get(id)) || 0;

        for (const family of families.values()) {
            planFamily(family, requirements, heldAmount, plan);
        }

        return plan;
    }

    window.CyrenePlannerMaterials = {
        compact: (value) => compactFormatter.format(value),
        craftingPlan,
    };
})();
