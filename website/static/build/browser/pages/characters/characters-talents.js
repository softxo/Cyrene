/* Alternate sprints share the active-skill type but are not upgradeable talents.
 * Combat skill IDs follow EnkaNetwork/API-docs store/characters.json SkillOrder.
 */
function getCharacterCombatTalents(character) {
    const skills = (Array.isArray(character?.skills) ? character.skills : [])
        .filter(skill => Number(skill.skill_type) === 1);
    const combatSkillIds = {
        "10000041": [10411, 10412, 10415], // Mona
        "10000002": [10024, 10018, 10019], // Kamisato Ayaka
    };
    const order = combatSkillIds[String(character?.id)];
    return order
        ? order.map(id => skills.find(skill => Number(skill.id) === id))
            .filter((skill) => Boolean(skill))
        : skills.slice(0, 3);
}
