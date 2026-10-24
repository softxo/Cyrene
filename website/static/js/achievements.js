window.initAchievements = function () {

    const categories = document.getElementById(
        "achievement-categories"
    );

    const categoryGrid = document.getElementById(
        "achievement-category-grid"
    );

    const browser = document.getElementById(
        "achievement-browser"
    );

    const backButton = document.getElementById(
        "achievement-back"
    );

    const sidebarList = document.getElementById(
        "achievement-sidebar-list"
    );

    const achievementList = document.getElementById(
        "achievement-list"
    );

    const categoryTitle = document.getElementById(
        "achievement-category-title"
    );

    const categoryPercent = document.getElementById(
        "achievement-category-percent"
    );

    const categoryProgressFill = document.getElementById(
        "achievement-category-progress-fill"
    );

    /* =========================================================
       ACHIEVEMENT NOTES MODAL
       ========================================================= */

    const achievementNotesModal = document.getElementById(
        "achievement-notes-modal"
    );

    const achievementNotesModalClose = document.getElementById(
        "achievement-notes-modal-close"
    );

    const achievementNotesModalCancel = document.getElementById(
        "achievement-notes-cancel"
    );

    const achievementNotesModalAdd = document.getElementById(
        "achievement-notes-add"
    );

    const achievementNotesModalBackdrop = document.getElementById(
        "achievement-notes-modal-backdrop"
    );

    const achievementNotesInput = document.getElementById(
        "achievement-notes-input"
    );

    function openAchievementNotesModal() {
        achievementNotesModal.hidden = false;

        achievementNotesInput.value = "";

        requestAnimationFrame(() => {
            achievementNotesInput.focus();
        });
    }


    function closeAchievementNotesModal() {
        achievementNotesModal.hidden = true;

        achievementNotesInput.value = "";
    }

    achievementNotesModalClose.addEventListener(
        "click",
        closeAchievementNotesModal
    );

    achievementNotesModalCancel.addEventListener(
        "click",
        closeAchievementNotesModal
    );

    achievementNotesModalBackdrop.addEventListener(
        "click",
        closeAchievementNotesModal
    );

    achievementNotesModalAdd.addEventListener(
        "click",
        async () => {

            const note =
                achievementNotesInput.value.trim();

            if (!note) {
                achievementNotesInput.focus();
                return;
            }

            if (!achievementNoteTarget) {
                return;
            }

            const {
                achievement,
                tier
            } = achievementNoteTarget;

            try {

                const response =
                    await fetch(
                        `/api/achievements/${encodeURIComponent(
                            tier.genshin_id
                        )}/tiers/${tier.tier}/note`,
                        {
                            method: "PATCH",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body: JSON.stringify({
                                note: note
                            })
                        }
                    );


                if (!response.ok) {

                    const result =
                        await response.json();

                    throw new Error(
                        result.detail ||
                        "Failed to save note."
                    );

                }


                /*
                 * Update the local achievement state
                 * only after the database save succeeds.
                 */

                tier.note =
                    note;


                /*
                 * Rebuild the achievement so the
                 * note immediately appears.
                 */

                buildAchievements(
                    achievement.category
                );


                console.log(
                    "Achievement note saved:",
                    achievement.name,
                    tier.tier,
                    note
                );


                closeAchievementNotesModal();

                achievementNoteTarget =
                    null;

            } catch (error) {

                console.error(
                    "[Achievements] Failed to save note:",
                    error
                );

                alert(
                    error.message
                );

            }

        }
    );

    let achievementData = null;

    let achievementSearchQuery = "";

    let hideCompletedAchievements = false;

    let achievementSelectedVersion = "all";

    let achievementNoteTarget = null;

    const CATEGORY_ICONS = {

        "Wonders of the World":
            "/static/images/achievements/categories/Wonders_of_the_World.png",

        "Memories of the Heart":
            "/static/images/achievements/categories/Memories_of_the_Heart.png",

        "Mortal Travails: Series I":
            "/static/images/achievements/categories/Mortal_Travails_Series_I.png",

        "Mortal Travails: Series II":
            "/static/images/achievements/categories/Mortal_Travails_Series_II.png",

        "Mortal Travails: Series III":
            "/static/images/achievements/categories/Mortal_Travails_Series_III.png",

        "Mortal Travails: Series IV":
            "/static/images/achievements/categories/Mortal_Travails_Series_IV.png",

        "Mortal Travails: Series V":
            "/static/images/achievements/categories/Mortal_Travails_Series_V.png",

        "Mortal Travails: Series VI":
            "/static/images/achievements/categories/Mortal_Travails_Series_VI.png",

        "Mortal Travails: Series VII":
            "/static/images/achievements/categories/Mortal_Travails_Series_VII.png",

        "The Art of Adventure":
            "/static/images/achievements/categories/The_Art_of_Adventure.png",

        "The Hero's Journey":
            "/static/images/achievements/categories/The_Heros_Journey.png",

        "Mondstadt: The City of Wind and Song":
            "/static/images/achievements/categories/Mondstadt_The_City_of_Wind_and_Song.png",

        "Liyue: The Harbor of Stone and Contracts":
            "/static/images/achievements/categories/Liyue_The_Harbor_of_Stone_and_Contracts.png",

        "Elemental Specialist: Series I":
            "/static/images/achievements/categories/Elemental_Specialist_Series_I.png",

        "Elemental Specialist: Series II":
            "/static/images/achievements/categories/Elemental_Specialist_Series_II.png",

        "Marksmanship":
            "/static/images/achievements/categories/Marksmanship.png",

        "Challenger: Series I":
            "/static/images/achievements/categories/Challenger_Series_I.png",

        "Challenger: Series II":
            "/static/images/achievements/categories/Challenger_Series_II.png",

        "Challenger: Series III":
            "/static/images/achievements/categories/Challenger_Series_III.png",

        "Challenger: Series IV":
            "/static/images/achievements/categories/Challenger_Series_IV.png",

        "Challenger: Series V":
            "/static/images/achievements/categories/Challenger_Series_V.png",

        "Challenger: Series VI":
            "/static/images/achievements/categories/Challenger_Series_VI.png",

        "Challenger: Series VII":
            "/static/images/achievements/categories/Challenger_Series_VII.png",

        "Challenger: Series VIII":
            "/static/images/achievements/categories/Challenger_Series_VIII.png",

        "Challenger: Series IX":
            "/static/images/achievements/categories/Challenger_Series_IX.png",

        "Challenger: Series X":
            "/static/images/achievements/categories/Challenger_Series_X.png",

        "Domains and Spiral Abyss: Series I":
            "/static/images/achievements/categories/Domains_and_Spiral_Abyss_Series_I.png",

        "Olah!: Series I":
            "/static/images/achievements/categories/Olah!_Series_I.png",

        "Snezhnaya Does Not Believe in Tears: Series I":
            "/static/images/achievements/categories/Snezhnaya_Does_Not_Believe_in_Tears_Series_I.png",

        "Stone Harbor's Nostalgia: Series I":
            "/static/images/achievements/categories/Stone_Harbors_Nostalgia_Series_I.png",

        "Meetings in Outrealm: Series I":
            "/static/images/achievements/categories/Meetings_in_Outrealm_Series_I.png",

        "Meetings in Outrealm: Series II":
            "/static/images/achievements/categories/Meetings_in_Outrealm_Series_II.png",

        "Meetings in Outrealm: Series III":
            "/static/images/achievements/categories/Meetings_in_Outrealm_Series_III.png",

        "Meetings in Outrealm: Series IV":
            "/static/images/achievements/categories/Meetings_in_Outrealm_Series_IV.png",

        "Meetings in Outrealm: Series V":
            "/static/images/achievements/categories/Meetings_in_Outrealm_Series_V.png",

        "Meetings in Outrealm: Series VI":
            "/static/images/achievements/categories/Meetings_in_Outrealm_Series_VI.png",

        "Meetings in Outrealm: Series VII":
            "/static/images/achievements/categories/Meetings_in_Outrealm_Series_VII.png",

        "Visitors on the Icy Mountain":
            "/static/images/achievements/categories/Visitors_on_the_Icy_Mountain.png",

        "A Realm Beyond: Series I":
            "/static/images/achievements/categories/A_Realm_Beyond_Series_I.png",

        "A Realm Beyond: Series II":
            "/static/images/achievements/categories/A_Realm_Beyond_Series_II.png",

        "A Realm Beyond: Series III":
            "/static/images/achievements/categories/A_Realm_Beyond_Series_III.png",

        "Inazuma: The Islands of Thunder and Eternity - Series I":
            "/static/images/achievements/categories/Inazuma_The_Islands_of_Thunder_and_Eternity_Series_I.png",

        "Inazuma: The Islands of Thunder and Eternity - Series II":
            "/static/images/achievements/categories/Inazuma_The_Islands_of_Thunder_and_Eternity_Series_II.png",

        "The Chronicles of the Sea of Fog":
            "/static/images/achievements/categories/The_Chronicles_of_the_Sea_of_Fog.png",

        "Teyvat Fishing Guide: Series I":
            "/static/images/achievements/categories/Teyvat_Fishing_Guide_Series_I.png",

        "The Light of Day":
            "/static/images/achievements/categories/The_Light_of_Day.png",

        "Chasmlighter":
            "/static/images/achievements/categories/Chasmlighter.png",

        "Sumeru: The Rainforest of Lore":
            "/static/images/achievements/categories/Sumeru_The_Rainforest_of_Lore.png",

        "Sumeru: The Gilded Desert - Series I":
            "/static/images/achievements/categories/Sumeru_The_Gilded_Desert_Series_I.png",

        "Sumeru: The Gilded Desert - Series II":
            "/static/images/achievements/categories/Sumeru_The_Gilded_Desert_Series_II.png",

        "Genius Invokation TCG":
            "/static/images/achievements/categories/Genius_Invokation_TCG.png",

        "Blessed Hamada":
            "/static/images/achievements/categories/Blessed_Hamada.png",

        "Fontaine: Dance of the Dew-White Springs (I)":
            "/static/images/achievements/categories/Fontaine_Dance_of_the_Dew_White_Springs_I.png",

        "Fontaine: Dance of the Dew-White Springs (II)":
            "/static/images/achievements/categories/Fontaine_Dance_of_the_Dew_White_Springs_II.png",

        "Fontaine: Dance of the Dew-White Springs (III)":
            "/static/images/achievements/categories/Fontaine_Dance_of_the_Dew_White_Springs_III.png",

        "Chenyu's Splendor":
            "/static/images/achievements/categories/Chenyus_Splendor.png",

        "Rhapsodia in the Ancient Sea":
            "/static/images/achievements/categories/Rhapsodia_in_the_Ancient_Sea.png",

        "Imaginarium Theater: The First Folio":
            "/static/images/achievements/categories/Imaginarium_Theater_The_First_Folio.png",

        "Imaginarium Theater: The Second Folio":
            "/static/images/achievements/categories/Imaginarium_Theater_The_Second_Folio.png",

        "Natlan: The Land of Fire and Competition (I)":
            "/static/images/achievements/categories/Natlan_The_Land_of_Fire_and_Competition_I.png",

        "Natlan: The Land of Fire and Competition (II)":
            "/static/images/achievements/categories/Natlan_The_Land_of_Fire_and_Competition_II.png",

        "Duelist: Series I":
            "/static/images/achievements/categories/Duelist_Series_I.png",

        "Duelist: Series II":
            "/static/images/achievements/categories/Duelist_Series_II.png",

        "Duelist: Series III":
            "/static/images/achievements/categories/Duelist_Series_III.png",

        "Repertoire of Myriad Melodies":
            "/static/images/achievements/categories/Repertoire_of_Myriad_Melodies.png",

        "Sacred Mountain's Fading Glow":
            "/static/images/achievements/categories/Sacred_Mountains_Fading_Glow.png",

        "A Summer of Ash and Prickly Pears":
            "/static/images/achievements/categories/A_Summer_of_Ash_and_Prickly_Pears.png",

        "Nod-Krai: An Elysium of Moonlight and Wanderings (I)":
            "/static/images/achievements/categories/Nod_Krai_An_Elysium_of_Moonlight_and_Wanderings_I.png",

        "Nod-Krai: An Elysium of Moonlight and Wanderings (II)":
            "/static/images/achievements/categories/Nod_Krai_An_Elysium_of_Moonlight_and_Wanderings_II.png",

        "Demon Mountain's Breath":
            "/static/images/achievements/categories/Demon_Mountains_Breath.png",

        "Unfettered Crescent":
            "/static/images/achievements/categories/Unfettered_Crescent.png",

        "Snezhnaya: Sacred city of ice and pale star (I)":
            "/static/images/achievements/categories/Snezhnaya_Sacred_city_of_ice_and_pale_star_I.png",

        "Land of Surging Shadows":
            "/static/images/achievements/categories/Land_of_Surging_Shadows.png",

    };

    const CATEGORY_SIDEBAR_ICONS = {

        "Wonders of the World":
            "/static/images/achievements/categories/sidebar/Wonders_of_the_World.png",

        "Memories of the Heart":
            "/static/images/achievements/categories/sidebar/Memories_of_the_Heart.png",

        "Mortal Travails: Series I":
            "/static/images/achievements/categories/sidebar/Mortal_Travails.png",

        "Mortal Travails: Series II":
            "/static/images/achievements/categories/sidebar/Mortal_Travails.png",

        "Mortal Travails: Series III":
            "/static/images/achievements/categories/sidebar/Mortal_Travails.png",

        "Mortal Travails: Series IV":
            "/static/images/achievements/categories/sidebar/Mortal_Travails.png",

        "Mortal Travails: Series V":
            "/static/images/achievements/categories/sidebar/Mortal_Travails.png",

        "Mortal Travails: Series VI":
            "/static/images/achievements/categories/sidebar/Mortal_Travails.png",

        "Mortal Travails: Series VII":
            "/static/images/achievements/categories/sidebar/Mortal_Travails.png",

        "The Art of Adventure":
            "/static/images/achievements/categories/sidebar/The_Art_of_Adventure.png",

        "The Hero's Journey":
            "/static/images/achievements/categories/sidebar/The_Heros_Journey.png",

        "Mondstadt: The City of Wind and Song":
            "/static/images/achievements/categories/sidebar/Mondstadt_The_City_of_Wind_and_Song.png",

        "Liyue: The Harbor of Stone and Contracts":
            "/static/images/achievements/categories/sidebar/Liyue_The_Harbor_of_Stone_and_Contracts.png",

        "Elemental Specialist: Series I":
            "/static/images/achievements/categories/sidebar/Elemental_Specialist_Series_I.png",

        "Elemental Specialist: Series II":
            "/static/images/achievements/categories/sidebar/Elemental_Specialist_Series_II.png",

        "Marksmanship":
            "/static/images/achievements/categories/sidebar/Marksmanship.png",

        "Challenger: Series I":
            "/static/images/achievements/categories/sidebar/Challenger.png",

        "Challenger: Series II":
            "/static/images/achievements/categories/sidebar/Challenger.png",

        "Challenger: Series III":
            "/static/images/achievements/categories/sidebar/Challenger.png",

        "Challenger: Series IV":
            "/static/images/achievements/categories/sidebar/Challenger.png",

        "Challenger: Series V":
            "/static/images/achievements/categories/sidebar/Challenger.png",

        "Challenger: Series VI":
            "/static/images/achievements/categories/sidebar/Challenger.png",

        "Challenger: Series VII":
            "/static/images/achievements/categories/sidebar/Challenger.png",

        "Challenger: Series VIII":
            "/static/images/achievements/categories/sidebar/Challenger.png",

        "Challenger: Series IX":
            "/static/images/achievements/categories/sidebar/Challenger.png",

        "Challenger: Series X":
            "/static/images/achievements/categories/sidebar/Challenger.png",

        "Domains and Spiral Abyss: Series I":
            "/static/images/achievements/categories/sidebar/Domains_and_Spiral_Abyss_Series_I.png",

        "Olah!: Series I":
            "/static/images/achievements/categories/sidebar/Olah!_Series_I.png",

        "Snezhnaya Does Not Believe in Tears: Series I":
            "/static/images/achievements/categories/sidebar/Snezhnaya_Does_Not_Believe_in_Tears_Series_I.png",

        "Stone Harbor's Nostalgia: Series I":
            "/static/images/achievements/categories/sidebar/Stone_Harbors_Nostalgia_Series_I.png",

        "Meetings in Outrealm: Series I":
            "/static/images/achievements/categories/sidebar/Meetings_in_Outrealm.png",

        "Meetings in Outrealm: Series II":
            "/static/images/achievements/categories/sidebar/Meetings_in_Outrealm.png",

        "Meetings in Outrealm: Series III":
            "/static/images/achievements/categories/sidebar/Meetings_in_Outrealm.png",

        "Meetings in Outrealm: Series IV":
            "/static/images/achievements/categories/sidebar/Meetings_in_Outrealm.png",

        "Meetings in Outrealm: Series V":
            "/static/images/achievements/categories/sidebar/Meetings_in_Outrealm.png",

        "Meetings in Outrealm: Series VI":
            "/static/images/achievements/categories/sidebar/Meetings_in_Outrealm.png",

        "Meetings in Outrealm: Series VII":
            "/static/images/achievements/categories/sidebar/Meetings_in_Outrealm.png",

        "Visitors on the Icy Mountain":
            "/static/images/achievements/categories/sidebar/Visitors_on_the_Icy_Mountain.png",

        "A Realm Beyond: Series I":
            "/static/images/achievements/categories/sidebar/A_Realm_Beyond.png",

        "A Realm Beyond: Series II":
            "/static/images/achievements/categories/sidebar/A_Realm_Beyond.png",

        "A Realm Beyond: Series III":
            "/static/images/achievements/categories/sidebar/A_Realm_Beyond.png",

        "Inazuma: The Islands of Thunder and Eternity - Series I":
            "/static/images/achievements/categories/sidebar/Inazuma_The_Islands_of_Thunder_and_Eternity.png",

        "Inazuma: The Islands of Thunder and Eternity - Series II":
            "/static/images/achievements/categories/sidebar/Inazuma_The_Islands_of_Thunder_and_Eternity.png",

        "The Chronicles of the Sea of Fog":
            "/static/images/achievements/categories/sidebar/Inazuma_The_Islands_of_Thunder_and_Eternity.png",

        "Teyvat Fishing Guide: Series I":
            "/static/images/achievements/categories/sidebar/Teyvat_Fishing_Guide_Series_I.png",

        "The Light of Day":
            "/static/images/achievements/categories/sidebar/The_Light_of_Day.png",

        "Chasmlighter":
            "/static/images/achievements/categories/sidebar/Chasmlighter.png",

        "Sumeru: The Rainforest of Lore":
            "/static/images/achievements/categories/sidebar/Sumeru_The_Rainforest_of_Lore.png",

        "Sumeru: The Gilded Desert - Series I":
            "/static/images/achievements/categories/sidebar/Sumeru_The_Gilded_Desert.png",

        "Sumeru: The Gilded Desert - Series II":
            "/static/images/achievements/categories/sidebar/Sumeru_The_Gilded_Desert.png",

        "Genius Invokation TCG":
            "/static/images/achievements/categories/sidebar/Genius_Invokation_TCG.png",

        "Blessed Hamada":
            "/static/images/achievements/categories/sidebar/Blessed_Hamada.png",

        "Fontaine: Dance of the Dew-White Springs (I)":
            "/static/images/achievements/categories/sidebar/Fontaine_Dance_of_the_Dew_White_Springs.png",

        "Fontaine: Dance of the Dew-White Springs (II)":
            "/static/images/achievements/categories/sidebar/Fontaine_Dance_of_the_Dew_White_Springs.png",

        "Fontaine: Dance of the Dew-White Springs (III)":
            "/static/images/achievements/categories/sidebar/Fontaine_Dance_of_the_Dew_White_Springs.png",

        "Chenyu's Splendor":
            "/static/images/achievements/categories/sidebar/Chenyus_Splendor.png",

        "Rhapsodia in the Ancient Sea":
            "/static/images/achievements/categories/sidebar/Rhapsodia_in_the_Ancient_Sea.png",

        "Imaginarium Theater: The First Folio":
            "/static/images/achievements/categories/sidebar/Imaginarium_Theater.png",

        "Imaginarium Theater: The Second Folio":
            "/static/images/achievements/categories/sidebar/Imaginarium_Theater.png",

        "Natlan: The Land of Fire and Competition (I)":
            "/static/images/achievements/categories/sidebar/Natlan_The_Land_of_Fire_and_Competition.png",

        "Natlan: The Land of Fire and Competition (II)":
            "/static/images/achievements/categories/sidebar/Natlan_The_Land_of_Fire_and_Competition.png",

        "Duelist: Series I":
            "/static/images/achievements/categories/sidebar/Duelist.png",

        "Duelist: Series II":
            "/static/images/achievements/categories/sidebar/Duelist.png",

        "Duelist: Series III":
            "/static/images/achievements/categories/sidebar/Duelist.png",

        "Repertoire of Myriad Melodies":
            "/static/images/achievements/categories/sidebar/Repertoire_of_Myriad_Melodies.png",

        "Sacred Mountain's Fading Glow":
            "/static/images/achievements/categories/sidebar/Sacred_Mountains_Fading_Glow.png",

        "A Summer of Ash and Prickly Pears":
            "/static/images/achievements/categories/sidebar/A_Summer_of_Ash_and_Prickly_Pears.png",

        "Nod-Krai: An Elysium of Moonlight and Wanderings (I)":
            "/static/images/achievements/categories/sidebar/Nod_Krai_An_Elysium_of_Moonlight_and_Wanderings.png",

        "Nod-Krai: An Elysium of Moonlight and Wanderings (II)":
            "/static/images/achievements/categories/sidebar/Nod_Krai_An_Elysium_of_Moonlight_and_Wanderings.png",

        "Demon Mountain's Breath":
            "/static/images/achievements/categories/sidebar/Demon_Mountains_Breath.png",

        "Unfettered Crescent":
            "/static/images/achievements/categories/sidebar/Unfettered_Crescent.png",

        "Snezhnaya: Sacred city of ice and pale star (I)":
            "/static/images/achievements/categories/sidebar/Snezhnaya_Sacred_city_of_ice_and_pale_star.png",

        "Land of Surging Shadows":
            "/static/images/achievements/categories/sidebar/Land_of_Surging_Shadows.png",

    };


    const CATEGORY_ORDER = [
        "Wonders of the World",
        "Memories of the Heart",
        "Mortal Travails: Series I",
        "Mortal Travails: Series II",
        "Mortal Travails: Series III",
        "Mortal Travails: Series IV",
        "Mortal Travails: Series V",
        "Mortal Travails: Series VI",
        "Mortal Travails: Series VII",
        "The Art of Adventure",
        "The Hero's Journey",
        "Mondstadt: The City of Wind and Song",
        "Liyue: The Harbor of Stone and Contracts",
        "Elemental Specialist: Series I",
        "Elemental Specialist: Series II",
        "Marksmanship",
        "Challenger: Series I",
        "Challenger: Series II",
        "Challenger: Series III",
        "Challenger: Series IV",
        "Challenger: Series V",
        "Challenger: Series VI",
        "Challenger: Series VII",
        "Challenger: Series VIII",
        "Challenger: Series IX",
        "Challenger: Series X",
        "Domain and Spiral Abyss: Series I",
        "Olah!: Series I",
        "Snezhnaya Does Not Believe in Tears: Series I",
        "Stone Harbor's Nostalgia: Series I",
        "Meetings in Outrealm: Series I",
        "Meetings in Outrealm: Series II",
        "Meetings in Outrealm: Series III",
        "Meetings in Outrealm: Series IV",
        "Meetings in Outrealm: Series V",
        "Meetings in Outrealm: Series VI",
        "Meetings in Outrealm: Series VII",
        "Visitors on the Icy Mountain",
        "A Realm Beyond: Series I",
        "A Realm Beyond: Series II",
        "A Realm Beyond: Series III",
        "Inazuma: The Islands of Thunder and Eternity - Series I",
        "Inazuma: The Islands of Thunder and Eternity - Series II",
        "Inazuma: The Islands of Thunder and Eternity - Series III",
        "The Chronicles of the Sea of Fog",
        "Teyvat Fishing Guide: Series I",
        "The Light of Day",
        "Chasmlighter",
        "Sumeru: The Rainforest of Lore",
        "Sumeru: The Gilded Desert I - Series I",
        "Sumeru: The Gilded Desert I - Series II",
        "Genius Invokation TCG",
        "Blessed Hamada",
        "Fontaine: Dance of the Dew-White Springs (I)",
        "Fontaine: Dance of the Dew-White Springs (II)",
        "Fontaine: Dance of the Dew-White Springs (III)",
        "Chenyu's Splendor",
        "Rhapsodia in the Ancient Sea",
        "Imaginarium Theater: The First Folio",
        "Imaginarium Theater: The Second Folio",
        "Natlan: The Land of Fire and Competition (I)",
        "Natlan: The Land of Fire and Competition (II)",
        "Duelist: Series I",
        "Duelist: Series II",
        "Duelist: Series III",
        "Repertoire of Myriad Melodies",
        "Sacred Mountain's Fading Glow",
        "A Summer of Ash and Prickly Pears",
        "Nod-Krai: An Elysium of Moonlight and Wanderings (I)",
        "Nod-Krai: An Elysium of Moonlight and Wanderings (II)",
        "Demon Mountain's Breath",
        "Unfettered Crescent",
        "Snezhnaya: Sacred city of ice and pale star (I)",
        "Land of Surging Shadows"
    ];



        /*
         * --------------------------------------------------
         * CATEGORY PAGE CONTROLS
         * --------------------------------------------------
         */

        const achievementSearch =
            document.getElementById(
                "achievement-search"
            );

        const achievementHideCompleted =
            document.getElementById(
                "achievement-hide-completed"
            );

        const achievementImportButton =
            document.getElementById(
                "achievement-import-button"
            );

        const achievementImportInput =
            document.getElementById(
                "achievement-import-input"
            );


        if (
            achievementImportButton &&
            achievementImportInput
        ) {

            achievementImportButton.addEventListener(
                "click",
                () => {

                    achievementImportInput.click();

                }
            );


            achievementImportInput.addEventListener(
                "change",
                async () => {

                    const file =
                        achievementImportInput.files[0];

                    if (!file) {
                        return;
                    }


                    const formData =
                        new FormData();

                    formData.append(
                        "file",
                        file
                    );


                    try {

                        const response =
                            await fetch(
                                "/api/achievements/import",
                                {
                                    method: "POST",
                                    body: formData,
                                }
                            );


                        const result =
                            await response.json();


                        if (!response.ok) {

                            throw new Error(
                                result.detail ||
                                "Failed to import achievements."
                            );

                        }


                        console.log(
                            "Achievement import:",
                            result
                        );


                        achievementImportInput.value = "";


                        await loadAchievements();

                    } catch (error) {

                        console.error(
                            "Achievement import failed:",
                            error
                        );

                        achievementImportInput.value = "";

                        alert(
                            error.message
                        );

                    }

                }
            );

        }


        /*
         * --------------------------------------------------
         * CATEGORY FILTERS
         * --------------------------------------------------
         */

        function getAchievementVersions(achievement) {

            if (!achievement.version) {
                return [];
            }

            return [
                String(achievement.version)
            ];

        }


        function buildVersionOptions() {

            const select =
                document.getElementById(
                    "achievement-version-select"
                );

            if (
                !select ||
                !achievementData
            ) {
                return;
            }


            const menu =
                select.querySelector(
                    ".custom-select-menu"
                );

            const value =
                select.querySelector(
                    ".custom-select-value"
                );


            if (
                !menu ||
                !value
            ) {
                return;
            }


            menu.innerHTML = "";


            const versions =
                new Set();


            achievementData.achievements.forEach(
                achievement => {

                    getAchievementVersions(
                        achievement
                    ).forEach(
                        version => {

                            versions.add(
                                version
                            );

                        }
                    );

                }
            );


            /*
             * ------------------------------------------
             * VERSION POSITION
             * ------------------------------------------
             */

            function getVersionPosition(version) {

                const value =
                    String(version).trim();


                /*
                 * Normal versions:
                 *
                 * 1.0
                 * 2.4
                 * 6.2
                 */

                const normalMatch =
                    value.match(/^(\d+)\.(\d+)$/);


                if (normalMatch) {

                    return {
                        major: Number(normalMatch[1]),
                        minor: Number(normalMatch[2])
                    };

                }


                /*
                 * Luna:
                 *
                 * "Luna IV" [6.3]
                 */

                const lunaMatch =
                    value.match(/\[(\d+)\.(\d+)\]/);


                if (lunaMatch) {

                    return {
                        major: Number(lunaMatch[1]),
                        minor: Number(lunaMatch[2])
                    };

                }


                return {
                    major: 999,
                    minor: 999
                };

            }


            function formatVersionLabel(version) {

                const value =
                    String(version).trim();


                const lunaMatch =
                    value.match(/^"?(Luna[^"]*)"?.*\[(\d+\.\d+)\]/i);


                if (lunaMatch) {

                    return lunaMatch[1];

                }


                return value;

            }


            /*
             * ------------------------------------------
             * SORT VERSIONS
             * ------------------------------------------
             */

            const sortedVersions =
                [...versions].sort((a, b) => {

                    const aPosition =
                        getVersionPosition(a);

                    const bPosition =
                        getVersionPosition(b);


                    /*
                     * Sort by major version first.
                     *
                     * 1.x
                     * 2.x
                     * 3.x
                     * ...
                     *
                     * Then sort by minor version
                     * inside each major version.
                     */

                    if (
                        aPosition.major !==
                        bPosition.major
                    ) {

                        return (
                            aPosition.major -
                            bPosition.major
                        );

                    }


                    return (
                        aPosition.minor -
                        bPosition.minor
                    );

                });


            /*
             * ------------------------------------------
             * ALL VERSIONS
             * ------------------------------------------
             */

            const allOption =
                document.createElement(
                    "button"
                );

            allOption.type =
                "button";

            allOption.className =
                "custom-select-option";

            allOption.classList.add(
                "version-all-option"
            );

            allOption.style.gridColumn = "1 / -1";

            allOption.dataset.value =
                "all";

            const allVersionsSelected =
                achievementSelectedVersion === "all";

            allOption.classList.toggle(
                "selected",
                allVersionsSelected
            );

            allOption.setAttribute(
                "aria-selected",
                allVersionsSelected
                    ? "true"
                    : "false"
            );

            allOption.textContent =
                "All Versions";

            allOption.setAttribute(
                "role",
                "option"
            );

            allOption.addEventListener(
            "click",
            () => {

                achievementSelectedVersion = "all";


                const hiddenVersionInput =
                    document.getElementById(
                        "achievement-version"
                    );


                if (hiddenVersionInput) {

                    hiddenVersionInput.value = "all";

                }


                value.textContent =
                    "All Versions";


                menu
                    .querySelectorAll(
                        ".custom-select-option"
                    )
                    .forEach(
                        otherOption => {

                            const selected =
                                otherOption ===
                                allOption;


                            otherOption.classList.toggle(
                                "selected",
                                selected
                            );


                            otherOption.setAttribute(
                                "aria-selected",
                                selected
                                    ? "true"
                                    : "false"
                            );

                        }
                    );


                select.classList.remove(
                    "open"
                );


                const button =
                    select.querySelector(
                        ".custom-select-button"
                    );


                if (button) {

                    button.setAttribute(
                        "aria-expanded",
                        "false"
                    );

                }


                buildCategories();

            }
        );

            menu.appendChild(
                allOption
            );

            /*
             * ------------------------------------------
             * BUILD VERSION GRID
             * ------------------------------------------
             *
             * Versions are arranged by:
             *
             *       1.x    2.x    3.x
             *       ─────────────────
             *  .0   1.0    2.0
             *  .1   1.1    2.1
             *  .2   1.2    2.2
             *  .3   1.3    2.3
             *
             * Missing versions leave an empty space.
             */

            const versionGroups = new Map();


            sortedVersions.forEach(version => {

                const position =
                    getVersionPosition(version);

                if (
                    position.major === 999
                ) {
                    return;
                }

                if (!versionGroups.has(position.major)) {

                    versionGroups.set(
                        position.major,
                        []
                    );

                }

                versionGroups
                    .get(position.major)
                    .push({
                        version,
                        minor: position.minor
                    });

            });


            /*
             * Sort the major-version columns.
             */

            const majorVersions =
                [...versionGroups.keys()]
                    .sort(
                        (a, b) => a - b
                    );


            /*
             * Find the highest minor version.
             *
             * This determines how many rows
             * the grid needs.
             */

            const maxMinor =
                Math.max(
                    ...[
                        ...versionGroups.values()
                    ].flatMap(
                        versions =>
                            versions.map(
                                entry => entry.minor
                            )
                    ),
                    0
                );


            /*
             * Build the grid row-by-row.
             *
             * This is important:
             *
             * Row 0:
             * 1.0   2.0
             *
             * Row 1:
             * 1.1   2.1
             *
             * Row 2:
             * 1.2   2.2
             *
             * etc.
             *
             * Missing versions are represented by
             * empty grid cells.
             */

            for (
                let minor = 0;
                minor <= maxMinor;
                minor++
            ) {

                majorVersions.forEach(
                    major => {

                        const versionsForMajor =
                            versionGroups.get(
                                major
                            );


                        const versionEntry =
                            versionsForMajor.find(
                                entry =>
                                    entry.minor === minor
                            );


                        /*
                         * No version exists at this
                         * position.
                         *
                         * Leave the grid cell empty.
                         */

                        if (!versionEntry) {

                            const spacer =
                                document.createElement(
                                    "div"
                                );

                            spacer.className =
                                "custom-select-option-spacer";

                            menu.appendChild(
                                spacer
                            );

                            return;

                        }


                        const version =
                            versionEntry.version;


                        const option =
                            document.createElement(
                                "button"
                            );

                        if (minor === 0) {
                            option.classList.add(
                                "achievement-version-first-row"
                            );
                        }


                        option.type =
                            "button";


                        option.className =
                            "custom-select-option";


                        option.setAttribute(
                            "role",
                            "option"
                        );


                        option.setAttribute(
                            "aria-selected",
                            "false"
                        );


                        option.dataset.value =
                            version;


                        option.textContent =
                            formatVersionLabel(
                                version
                            );


                        option.addEventListener(
                            "click",
                            () => {

                                const selectedValue =
                                    option.dataset.value;


                                achievementSelectedVersion =
                                    selectedValue;


                                const hiddenVersionInput =
                                    document.getElementById(
                                        "achievement-version"
                                    );


                                if (hiddenVersionInput) {

                                    hiddenVersionInput.value =
                                        selectedValue;

                                }


                                value.textContent =
                                    option.textContent;


                                menu
                                    .querySelectorAll(
                                        ".custom-select-option"
                                    )
                                    .forEach(
                                        otherOption => {

                                            const selected =
                                                otherOption ===
                                                option;


                                            otherOption.classList.toggle(
                                                "selected",
                                                selected
                                            );


                                            otherOption.setAttribute(
                                                "aria-selected",
                                                selected
                                                    ? "true"
                                                    : "false"
                                            );

                                        }
                                    );


                                select.classList.remove(
                                    "open"
                                );


                                select
                                    .querySelector(
                                        ".custom-select-button"
                                    )
                                    .setAttribute(
                                        "aria-expanded",
                                        "false"
                                    );


                                buildCategories();

                            }
                        );


                        menu.appendChild(
                            option
                        );

                    }
                );

            }


            /*
             * ------------------------------------------
             * RESTORE SELECTED VERSION
             * ------------------------------------------
             */

            menu
                .querySelectorAll(
                    ".custom-select-option"
                )
                .forEach(option => {

                    const selected =
                        option.dataset.value ===
                        achievementSelectedVersion;

                    option.classList.toggle(
                        "selected",
                        selected
                    );

                    option.setAttribute(
                        "aria-selected",
                        selected
                            ? "true"
                            : "false"
                    );

                });


            function focusSelectedVersionOption() {

                const selectedOption =
                    menu.querySelector(
                        ".custom-select-option.selected"
                    );

                if (!selectedOption) {
                    return;
                }

                /*
                 * Make sure the selected option is
                 * actually keyboard-focusable.
                 */
                selectedOption.setAttribute(
                    "tabindex",
                    "0"
                );

                /*
                 * Move real browser focus to it.
                 */
                selectedOption.focus({
                    preventScroll: true
                });

            }

            /*
             * ------------------------------------------
             * DROPDOWN BUTTON
             * ------------------------------------------
             */

            const button =
                select.querySelector(
                    ".custom-select-button"
                );

            if (button) {

                button.onclick = function (event) {

                    event.preventDefault();
                    event.stopPropagation();

                    const shouldOpen =
                        !select.classList.contains("open");


                    /*
                     * Close every other custom dropdown.
                     */

                    document
                        .querySelectorAll(
                            ".custom-select.open"
                        )
                        .forEach(
                            otherSelect => {

                                if (
                                    otherSelect !== select
                                ) {

                                    otherSelect.classList.remove(
                                        "open"
                                    );

                                    const otherButton =
                                        otherSelect.querySelector(
                                            ".custom-select-button"
                                        );

                                    if (otherButton) {

                                        otherButton.setAttribute(
                                            "aria-expanded",
                                            "false"
                                        );

                                    }

                                }

                            }
                        );


                    /*
                     * Toggle this dropdown.
                     */

                    select.classList.toggle(
                        "open",
                        shouldOpen
                    );


                    button.setAttribute(
                        "aria-expanded",
                        shouldOpen
                            ? "true"
                            : "false"
                    );


                    /*
                     * Focus the currently selected option.
                     *
                     * Do this after opening so the browser
                     * has already applied the open state.
                     */

                    if (shouldOpen) {

                        requestAnimationFrame(() => {

                            requestAnimationFrame(() => {

                                focusSelectedVersionOption();

                            });

                        });

                    }

                };

            }

        }


        function achievementIsCompleted(
            achievement
        ) {

            if (
                !Array.isArray(
                    achievement.tiers
                ) ||
                achievement.tiers.length === 0
            ) {

                return false;

            }


            return achievement.tiers.every(
                tier =>
                    tier.completed === true
            );

        }


        function achievementMatchesFilters(
            achievement
        ) {

            /*
             * ------------------------------------------
             * SEARCH
             * ------------------------------------------
             */

            if (achievementSearchQuery) {

                const query =
                    achievementSearchQuery
                        .toLowerCase()
                        .trim();


                const name =
                    String(
                        achievement.name || ""
                    ).toLowerCase();


                const descriptions =
                    Array.isArray(
                        achievement.tiers
                    )
                        ? achievement.tiers
                            .map(
                                tier =>
                                    String(
                                        tier.description ||
                                        ""
                                    )
                            )
                            .join(" ")
                            .toLowerCase()
                        : "";


                if (
                    !name.includes(query) &&
                    !descriptions.includes(query)
                ) {

                    return false;

                }

            }


            /*
             * ------------------------------------------
             * VERSION
             * ------------------------------------------
             */

            if (
                achievementSelectedVersion !== "all"
            ) {

                const versions =
                    getAchievementVersions(
                        achievement
                    );


                if (
                    !versions.includes(
                        achievementSelectedVersion
                    )
                ) {

                    return false;

                }

            }


            /*
             * ------------------------------------------
             * HIDE COMPLETED
             * ------------------------------------------
             */

            if (
                hideCompletedAchievements &&
                achievementIsCompleted(
                    achievement
                )
            ) {

                return false;

            }


            return true;

        }


        function rebuildCategoryView() {

            buildCategories();

        }


        if (achievementSearch) {

            achievementSearch.addEventListener(
                "input",
                () => {

                    achievementSearchQuery =
                        achievementSearch.value;

                    rebuildCategoryView();

                }
            );

        }


        if (achievementHideCompleted) {

            achievementHideCompleted.addEventListener(
                "change",
                () => {

                    hideCompletedAchievements =
                        achievementHideCompleted.checked;

                    rebuildCategoryView();

                }
            );

        }


    /*
     * --------------------------------------------------
     * LOAD ACHIEVEMENTS
     * --------------------------------------------------
     */

    async function loadAchievements() {

        try {

            const response = await fetch(
                "/api/achievements"
            );


            if (!response.ok) {

                throw new Error(
                    "Failed to load achievements."
                );

            }


            achievementData =
                await response.json();

            buildVersionOptions();

            buildCategories();

            updateOverallAchievementProgress();

        } catch (error) {

            console.error(
                "[Achievements] INITIALIZATION ERROR:",
                error
            );

        }

    }


    /*
     * --------------------------------------------------
     * BUILD CATEGORY CARDS
     * --------------------------------------------------
     */

    function buildCategories() {

        if (!categoryGrid || !achievementData) {
            return;
        }


        categoryGrid.innerHTML = "";


        const categoryEntries =
            CATEGORY_ORDER.map(
                category => {

                    const data =
                        achievementData.categories[category];

                    if (!data) {
                        return null;
                    }

                    /*
                     * Get only achievements belonging
                     * to this category.
                     */

                    const categoryAchievements =
                        achievementData.achievements.filter(
                            achievement =>
                                achievement.category === category
                        );


                    /*
                     * Apply the currently active
                     * Search / Version / Hide Completed
                     * filters.
                     */

                    const filteredAchievements =
                        categoryAchievements.filter(
                            achievement =>
                                achievementMatchesFilters(
                                    achievement
                                )
                        );


                    /*
                     * Don't display categories that
                     * have no matching achievements.
                     */

                    if (
                        filteredAchievements.length === 0
                    ) {

                        return null;

                    }


                    /*
                     * Count tiers rather than achievement
                     * objects, matching the way Overall
                     * Progress is calculated.
                     */

                    let total = 0;
                    let completed = 0;


                    filteredAchievements.forEach(
                        achievement => {

                            if (
                                !Array.isArray(
                                    achievement.tiers
                                )
                            ) {
                                return;
                            }


                            achievement.tiers.forEach(
                                tier => {

                                    total++;


                                    if (
                                        tier.completed === true
                                    ) {

                                        completed++;

                                    }

                                }
                            );

                        }
                    );


                    return {
                        category,
                        data,
                        total,
                        completed
                    };

                }
            )
            .filter(Boolean);


        /*
         * Build category cards.
         */

        categoryEntries.forEach(
            ({
                category,
                total,
                completed
            }) => {

                const button =
                    document.createElement("button");


                button.type =
                    "button";


                button.className =
                    "achievement-category";


                const progress =
                    total > 0
                        ? (completed / total) * 100
                        : 0;


                button.innerHTML = `

                    <div class="achievement-category-icon">
                
                        <img
                            src="${
                                CATEGORY_ICONS[category]
                                || "/static/images/Achievements.webp"
                            }"
                            alt=""
                        >
                
                    </div>
                
                
                    <div class="achievement-category-content">
                
                        <h3 class="${
                            category.length > 30
                                ? "long-category-name"
                                : ""
                        }">
                            ${escapeHTML(category)}
                        </h3>
                
                
                        <div class="achievement-category-stats">

                            <strong class="achievement-category-percent">
                                ${progress.toFixed(1)}%
                            </strong>
                        
                            <span class="achievement-category-count">
                                ${completed}/${total}
                            </span>
                        
                        </div>
                
                
                        <div
                            class="achievement-category-progress"
                        >
                
                            <div
                                class="achievement-sidebar-progress-fill"
                                style="width: ${progress}%"
                            ></div>
                
                        </div>
                
                    </div>
                
                `;


                button.addEventListener(
                    "click",
                    () => {

                        openCategory(category);

                    }
                );


                categoryGrid.appendChild(
                    button
                );

            }
        );
    }


    /*
     * --------------------------------------------------
     * BUILD SIDEBAR
     * --------------------------------------------------
     */

    function buildSidebar(
        selectedCategory
    ) {

        if (!sidebarList || !achievementData) {
            return;
        }


        sidebarList.innerHTML = "";


        CATEGORY_ORDER.forEach(
            category => {

                const data =
                    achievementData.categories[category];

                if (!data) {
                    return;
                }

                const button =
                    document.createElement("button");

                button.type = "button";

                button.className =
                    "achievement-sidebar-item";


                if (
                    category === selectedCategory
                ) {

                    button.classList.add("active");

                }


                const progress =
                    data.total > 0
                        ? (data.completed / data.total) * 100
                        : 0;


                button.innerHTML = `
                
                    <div class="achievement-sidebar-icon">
                
                        <img
                            src="${
                                CATEGORY_SIDEBAR_ICONS[category]
                                || "/static/images/Achievements.webp"
                            }"
                            alt=""
                        >
                
                    </div>
                
                
                    <div class="achievement-sidebar-content">
                
                        <span class="achievement-sidebar-name">
                            ${escapeHTML(category)}
                        </span>
                
                
                        <div class="achievement-sidebar-progress-row">
                
                            <div class="achievement-sidebar-progress">
                
                                <div
                                    class="achievement-sidebar-progress-fill"
                                    style="width: ${progress}%"
                                ></div>
                
                            </div>
                
                
                            <small>
                                ${data.completed}/${data.total}
                            </small>
                
                        </div>
                
                    </div>
                
                `;


                button.addEventListener(
                    "click",
                    () => {

                        openCategory(category);

                    }
                );


                sidebarList.appendChild(button);

            }
        );

    }


    /*
     * --------------------------------------------------
     * OPEN CATEGORY
     * --------------------------------------------------
     */

    function openCategory(category) {

        if (!achievementData) {
            return;
        }


        const data =
            achievementData.categories[category];


        if (!data) {
            return;
        }


        categoryTitle.textContent =
            category;


        const percentage =
            data.total > 0
                ? (data.completed / data.total) * 100
                : 0;


        const roundedPercentage =
            Math.round(percentage * 10) / 10;


        categoryPercent.textContent =
            `${roundedPercentage}% (${data.completed}/${data.total})`;


        categoryProgressFill.style.width =
            `${percentage}%`;


        buildSidebar(category);

        buildAchievements(category);


        categories.hidden = true;

        browser.hidden = false;

    }


    function formatCompletedAt(timestamp) {

        if (
            timestamp === null ||
            timestamp === undefined ||
            timestamp === ""
        ) {
            return "";
        }

        let date;

        /*
         * Unix timestamp.
         *
         * If the value is small enough to be seconds,
         * convert it to milliseconds first.
         */

        if (
            typeof timestamp === "number" ||
            /^\d+$/.test(String(timestamp))
        ) {

            const numericTimestamp =
                Number(timestamp);

            date =
                new Date(
                    numericTimestamp < 100000000000
                        ? numericTimestamp * 1000
                        : numericTimestamp
                );

        } else {

            /*
             * ISO timestamp, e.g.
             *
             * 2026-08-27T11:28:16.904Z
             */

            date =
                new Date(timestamp);

        }

        if (Number.isNaN(date.getTime())) {
            return "";
        }

        const day =
            String(
                date.getDate()
            ).padStart(2, "0");

        const month =
            String(
                date.getMonth() + 1
            ).padStart(2, "0");

        const year =
            date.getFullYear();

        const hours =
            String(
                date.getHours()
            ).padStart(2, "0");

        const minutes =
            String(
                date.getMinutes()
            ).padStart(2, "0");

        return `${day}-${month}-${year} ${hours}:${minutes}`;
    }


    function formatAchievementNote(note) {

        if (!note) {
            return "";
        }

        const lines =
            escapeHTML(note)
                .split(/\r?\n/);

        let html = "";
        let inList = false;

        lines.forEach(line => {

            const bulletMatch =
                line.match(/^\s*-\s+(.*)$/);

            if (bulletMatch) {

                if (!inList) {
                    html += "<ul>";
                    inList = true;
                }

                html += `
                    <li>${bulletMatch[1]}</li>
                `;

                return;
            }

            if (inList) {
                html += "</ul>";
                inList = false;
            }

            if (line.trim() === "") {
                html += "<br>";
            } else {
                html += `${line}<br>`;
            }

        });

        if (inList) {
            html += "</ul>";
        }

        return html;
    }


    /*
     * --------------------------------------------------
     * BUILD ACHIEVEMENTS
     * --------------------------------------------------
     */

    function buildAchievements(category) {

        if (
            !achievementList ||
            !achievementData
        ) {
            return;
        }


        achievementList.innerHTML = "";


        const achievements =
            achievementData.achievements.filter(
                achievement =>
                    achievement.category === category &&
                    achievementMatchesFilters(achievement)
            );


        achievements.forEach(
            achievement => {

                const item =
                    document.createElement("div");

                item.className =
                    "achievement-item";


                const totalTiers =
                    achievement.tiers?.length || 1;


                item.innerHTML = `
    
                    <!-- Large achievement icon -->
    
                    <div class="achievement-item-icon">
    
                        <img
                            class="achievement-item-main-icon"
                            src="${getTierImage(
                                0,
                                totalTiers
                            )}"
                            alt=""
                        >
    
                    </div>
    
    
                    <!-- Achievement content -->
    
                    <div class="achievement-item-content">
    
                        <div class="achievement-item-header">

                            <div class="achievement-title-row">

                                <h3>
                                    ${escapeHTML(
                                        achievement.name
                                    )}
                                </h3>
                            
                                ${
                                    achievement.version
                                        ? `
                                            <span class="achievement-version-badge">
                                                ${escapeHTML(
                                                    achievement.version
                                                )}
                                            </span>
                                        `
                                        : ""
                                }
                            
                            </div>
                        
                        </div>
    
    
                        <div class="achievement-tier-list">
    
                            ${achievement.tiers.map(
                                tier => {
    
                                    return `
    
                                        <div
                                            class="achievement-tier ${
                                                tier.completed ? "completed" : ""
                                            }"
                                            data-tier="${tier.tier}"
                                        >
    
                                            <!-- Small tier icon -->
    
                                            <div class="achievement-tier-icon">
    
                                                <img
                                                    src="${getTierImage(
                                                        tier.tier,
                                                        totalTiers
                                                    )}"
                                                    alt="${tier.tier}/${totalTiers}"
                                                >
    
                                            </div>
    
    
                                            <div class="achievement-tier-content">

                                                <div class="achievement-tier-description">
                                                    <p>
                                                        ${escapeHTML(
                                                            tier.description
                                                        )}
                                                    </p>
                                                </div>
                                            
                                                ${
                                                    achievement.show_progress ||
                                                    tier.progress !== 1 ||
                                                    (tier.completed && tier.timestamp)
                                                        ? `
                                                            <div class="achievement-tier-progress-row">
                                                
                                                                ${
                                                                    achievement.show_progress ||
                                                                    tier.progress !== 1
                                                                        ? `
                                                                            <div class="achievement-tier-progress">
                                                
                                                                                <span class="achievement-tier-progress-current">
                                                                                    ${tier.current ?? 0}
                                                                                </span>
                                                
                                                                                <span class="achievement-tier-progress-separator">
                                                                                    /
                                                                                </span>
                                                
                                                                                <span class="achievement-tier-progress-total">
                                                                                    ${tier.progress ?? 0}
                                                                                </span>
                                                
                                                                            </div>
                                                                        `
                                                                        : ""
                                                                }
                                                
                                                                ${
                                                                    tier.completed && tier.timestamp
                                                                        ? `
                                                                            <span class="achievement-tier-completed-at">
                                                                                ${formatCompletedAt(
                                                                                    tier.timestamp
                                                                                )}
                                                                            </span>
                                                                        `
                                                                        : ""
                                                                }
                                                
                                                            </div>
                                                        `
                                                        : ""
                                                }
                                            
                                                ${
                                                    tier.note
                                                        ? `
                                                            <div class="achievement-tier-note">
                                                                
                                                                <div class="achievement-tier-note-text">
                                                                    ${formatAchievementNote(tier.note)}
                                                                </div>
                                                
                                                                <button
                                                                    type="button"
                                                                    class="achievement-tier-note-remove"
                                                                    aria-label="Remove Note"
                                                                    title="Remove Note"
                                                                >
                                                                    ×
                                                                </button>
                                                
                                                            </div>
                                                        `
                                                        : ""
                                                }
                                            
                                            </div>
                                            
                                            <div class="achievement-tier-reward">

                                                <span>
                                                    ${tier.primogems ?? 0}
                                                </span>
                                            
                                                <img
                                                    src="/static/images/misc/Primogem.webp"
                                                    alt="Primogems"
                                                >
                                            
                                            </div>
                                            
                                            
                                            <!-- Completion -->

                                            <button
                                                type="button"
                                                class="achievement-complete-button ${
                                                    tier.completed ? "completed" : ""
                                                }"
                                                aria-label="${
                                                    tier.completed
                                                        ? "Mark Incomplete"
                                                        : "Mark Completed"
                                                }"
                                                title="${
                                                    tier.completed
                                                        ? "Mark Incomplete"
                                                        : "Mark Completed"
                                                }"
                                            ></button>
                                            
                                            
                                            <!-- Notes -->
                                            
                                            <button
                                                type="button"
                                                class="achievement-notes-button"
                                                aria-label="Add Note"
                                                title="Add Note"
                                            >
                                                <svg
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    xmlns="http://www.w3.org/2000/svg"
                                                    aria-hidden="true"
                                                    focusable="false"
                                                >
                                                    <path
                                                        d="M11 4H7.2C6.0799 4 5.51984 4 5.09202 4.21799C4.71569 4.40974 4.40974 4.7157 4.21799 5.09202C4 5.51985 4 6.0799 4 7.2V16.8C4 17.9201 4 18.4802 4.21799 18.908C4.40974 19.2843 4.71569 19.5903 5.09202 19.782C5.51984 20 6.0799 20 7.2 20H16.8C17.9201 20 18.4802 20 18.908 19.782C19.2843 19.5903 19.5903 19.2843 19.5903 19.2843 19.5903 19.5903 18.908 20 18.4802 20 17.9201 20 16.8V12.5"
                                                        stroke="currentColor"
                                                        stroke-width="2"
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                    />
                                            
                                                    <path
                                                        d="M15.5 5.5L18.3284 8.32843M10.7627 10.2373L17.411 3.58902C18.192 2.80797 19.4584 2.80797 20.2394 3.58902C21.0205 4.37007 21.0205 5.6364 20.2394 6.41745L13.3774 13.2794C12.6158 14.0411 12.235 14.4219 11.8012 14.7247C11.4162 14.9936 11.0009 15.2162 10.564 15.3882C10.0717 15.582 9.54378 15.6885 8.48793 15.9016L8 16L8.04745 15.6678C8.21536 14.4925 8.29932 13.9048 8.49029 13.3561 9.17906 11.9786 9.50341 11.4966 9.92319 11.0768 10.7627 10.2373Z"
                                                        stroke="currentColor"
                                                        stroke-width="2"
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                    />
                                                </svg>
                                            </button>
    
                                        </div>
    
                                    `;
    
                                }
                            ).join("")}
    
                        </div>
    
                    </div>
    
                `;

                item.querySelectorAll(
                    ".achievement-tier"
                ).forEach(tierElement => {

                    const description =
                        tierElement.querySelector(
                            ".achievement-tier-description p"
                        );

                    const descriptionContainer =
                        tierElement.querySelector(
                            ".achievement-tier-description"
                        );

                    if (
                        !description ||
                        !descriptionContainer
                    ) {
                        return;
                    }

                    const lineHeight =
                        parseFloat(
                            window.getComputedStyle(
                                description
                            ).lineHeight
                        );

                    const height =
                        description.getBoundingClientRect().height;

                    const isMultiline =
                        height > lineHeight * 1.5;

                    descriptionContainer.classList.toggle(
                        "multiline",
                        isMultiline
                    );

                });


                const tierButtons =
                    item.querySelectorAll(
                        ".achievement-complete-button"
                    );

                const notesButtons =
                    item.querySelectorAll(
                        ".achievement-notes-button"
                    );

                const noteRemoveButtons =
                    item.querySelectorAll(
                        ".achievement-tier-note-remove"
                    );


                notesButtons.forEach(
                    button => {

                        button.addEventListener(
                            "click",
                            event => {

                                event.stopPropagation();

                                achievementNoteTarget = {
                                    achievement,
                                    tier: achievement.tiers[
                                        Array.from(
                                            notesButtons
                                        ).indexOf(button)
                                    ]
                                };

                                const modal =
                                    document.getElementById(
                                        "achievement-notes-modal"
                                    );

                                const input =
                                    document.getElementById(
                                        "achievement-notes-input"
                                    );

                                if (!modal || !input) {
                                    return;
                                }

                                /*
                                 * Clear the input whenever the
                                 * Notes button is opened.
                                 */

                                input.value = "";

                                /*
                                 * Show the modal.
                                 */

                                modal.hidden = false;

                                /*
                                 * Focus the textarea so the user
                                 * can immediately start typing.
                                 */

                                requestAnimationFrame(() => {

                                    input.focus();

                                });

                            }
                        );

                    }
                );


                noteRemoveButtons.forEach(
                    button => {

                        button.addEventListener(
                            "click",
                            async event => {

                                event.stopPropagation();

                                const tierElement =
                                    button.closest(
                                        ".achievement-tier"
                                    );

                                if (!tierElement) {
                                    return;
                                }

                                const tierNumber =
                                    Number(
                                        tierElement.dataset.tier
                                    );

                                const tier =
                                    achievement.tiers.find(
                                        achievementTier =>
                                            achievementTier.tier === tierNumber
                                    );

                                if (!tier) {
                                    return;
                                }

                                try {

                                    const response =
                                        await fetch(
                                            `/api/achievements/${encodeURIComponent(
                                                tier.genshin_id
                                            )}/tiers/${tier.tier}/note`,
                                            {
                                                method: "PATCH",

                                                headers: {
                                                    "Content-Type":
                                                        "application/json"
                                                },

                                                body: JSON.stringify({
                                                    note: null
                                                })
                                            }
                                        );


                                    if (!response.ok) {

                                        const result =
                                            await response.json();

                                        throw new Error(
                                            result.detail ||
                                            "Failed to remove note."
                                        );

                                    }


                                    /*
                                     * Update local state.
                                     */

                                    tier.note = null;


                                    /*
                                     * Remove the note box immediately.
                                     */

                                    const noteElement =
                                        button.closest(
                                            ".achievement-tier-note"
                                        );

                                    if (noteElement) {

                                        noteElement.remove();

                                    }


                                    console.log(
                                        "Achievement note removed:",
                                        achievement.name,
                                        tier.tier
                                    );

                                } catch (error) {

                                    console.error(
                                        "[Achievements] Failed to remove note:",
                                        error
                                    );

                                    alert(
                                        error.message
                                    );

                                }

                            }
                        );

                    }
                );


                tierButtons.forEach(
                    (button, index) => {

                        const tier =
                            achievement.tiers[index];


                        button.addEventListener(
                            "click",
                            () => {

                                console.log(
                                    "[Achievements] Completion button clicked",
                                    {
                                        achievement: achievement.name,
                                        tier: tier.tier,
                                        completed: tier.completed,
                                        disabled: button.disabled,
                                        locked: button.closest(
                                            ".achievement-tier"
                                        )?.classList.contains("locked")
                                    }
                                );

                                toggleTierCompleted(
                                    achievement,
                                    tier,
                                    item,
                                    button
                                );

                            }
                        );

                    }
                );


                achievementList.appendChild(item);

                updateLockedTiers(item);
                updateAchievementProgress(item);

            }
        );

    }

    function getTierImage(
        currentTier,
        totalTiers
    ) {

        return `/static/images/achievements/tiers/Achievement_${currentTier}_${totalTiers}.png`;

    }


    /*
     * --------------------------------------------------
     * ACHIEVEMENT DESCRIPTION
     * --------------------------------------------------
     */

    function getAchievementDescription(achievement) {

        if (
            !achievement.tiers ||
            achievement.tiers.length === 0
        ) {
            return "";
        }


        const totalTiers =
            achievement.tiers.length;


        return achievement.tiers
            .map(tier => {

                const tierNumber =
                    tier.tier;


                return `
                    <div class="achievement-tier-row">
    
                        <img
                            src="${getTierImage(
                                tierNumber,
                                totalTiers
                            )}"
                            alt="${tierNumber}/${totalTiers}"
                        >
    
                        <span>
                            ${escapeHTML(
                                tier.description
                            )}
                        </span>
    
                    </div>
                `;

            })
            .join("");

    }


    /*
     * --------------------------------------------------
     * MARK COMPLETED
     * --------------------------------------------------
     */

    async function toggleTierCompleted(
        achievement,
        tier,
        item,
        button
    ) {

        const totalTiers =
            achievement.tiers?.length || 1;


        const tierContainer =
            button.closest(
                ".achievement-tier"
            );

        if (
            tierContainer.classList.contains(
                "locked"
            )
        ) {
            return;
        }


        const tierImage =
            tierContainer.querySelector(
                ".achievement-tier-icon img"
            );


        const isCompleted =
            tier.completed === true;

        /*
         * ------------------------------------------
         * UPDATE LOCAL STATE
         * ------------------------------------------
         */

        if (isCompleted) {

            /*
             * Uncompleting a tier also uncompletes
             * every tier after it.
             */

            achievement.tiers.forEach(
                achievementTier => {

                    if (
                        achievementTier.tier >= tier.tier
                    ) {

                        achievementTier.completed = false;
                        achievementTier.timestamp = null;

                    }

                }
            );

        } else {

            tier.completed = true;

        }


        /*
         * ------------------------------------------
         * SAVE TO DATABASE
         * ------------------------------------------
         */

        try {

            /*
             * When completing:
             *
             * Only the clicked tier changes.
             *
             * When uncompleting:
             *
             * The clicked tier and every tier after
             * it must be saved as incomplete.
             */

            const tiersToSave =
                isCompleted
                    ? achievement.tiers.filter(
                        achievementTier =>
                            achievementTier.tier >= tier.tier
                    )
                    : [tier];


            for (
                const achievementTier
                of tiersToSave
            ) {

                const response =
                    await fetch(
                        `/api/achievements/${encodeURIComponent(
                            achievementTier.genshin_id
                        )}/tiers/${achievementTier.tier}`,
                        {
                            method: "PATCH",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body: JSON.stringify({
                                completed:
                                    achievementTier.completed
                            })
                        }
                    );


                if (!response.ok) {

                    throw new Error(
                        `Failed to save Tier ${achievementTier.tier}.`
                    );

                }

            }

        } catch (error) {

            console.error(
                "[Achievements] Failed to save completion:",
                error
            );


            /*
             * The database update failed.
             *
             * Reload the achievement data so the UI
             * returns to the actual saved state.
             */

            await loadAchievements();

            return;

        }


        /*
         * ------------------------------------------
         * UPDATE ALL TIER UI
         * ------------------------------------------
         */

        achievement.tiers.forEach(
            achievementTier => {

                /*
                 * Only tiers affected by this action
                 * need their visual state changed.
                 */

                if (
                    isCompleted &&
                    achievementTier.tier < tier.tier
                ) {
                    return;
                }


                const otherTier =
                    item.querySelector(
                        `.achievement-tier[data-tier="${achievementTier.tier}"]`
                    );


                if (!otherTier) {
                    return;
                }


                const otherButton =
                    otherTier.querySelector(
                        ".achievement-complete-button"
                    );


                const otherImage =
                    otherTier.querySelector(
                        ".achievement-tier-icon img"
                    );


                const completed =
                    achievementTier.completed === true;


                /*
                 * Completed state
                 */

                otherTier.classList.toggle(
                    "completed",
                    completed
                );


                if (otherButton) {

                    otherButton.classList.toggle(
                        "completed",
                        completed
                    );

                    otherButton.title =
                        completed
                            ? "Mark Incomplete"
                            : "Mark Completed";

                }


                /*
                 * Tier icon
                 */

                if (otherImage) {

                    otherImage.src =
                        getTierImage(
                            achievementTier.tier,
                            totalTiers
                        );

                    otherImage.alt =
                        `${achievementTier.tier}/${totalTiers}`;

                }

            }
        );


        /*
         * ------------------------------------------
         * UPDATE COMPLETED AT
         * ------------------------------------------
         */

        const updatedTier =
            tierContainer;

        const tierContent =
            updatedTier.querySelector(
                ".achievement-tier-content"
            );

        if (tierContent) {

            const descriptionContainer =
                tierContent.querySelector(
                    ".achievement-tier-description"
                );

            let progressRow =
                tierContent.querySelector(
                    ".achievement-tier-progress-row"
                );

            /*
             * ------------------------------------------
             * COMPLETED
             * ------------------------------------------
             *
             * The achievement was just checked.
             *
             * Create/update the Completed At display.
             */

            if (achievement.tiers.find(
                achievementTier =>
                    achievementTier.tier === tier.tier
            )?.completed) {

                const completedAt =
                    new Date();

                const formattedCompletedAt =
                    formatCompletedAt(
                        completedAt.toISOString()
                    );

                /*
                 * Create the progress row if it
                 * doesn't already exist.
                 */

                if (!progressRow) {

                    progressRow =
                        document.createElement(
                            "div"
                        );

                    progressRow.className =
                        "achievement-tier-progress-row";

                    /*
                     * The progress row belongs directly
                     * after the description.
                     */

                    if (descriptionContainer) {

                        descriptionContainer.insertAdjacentElement(
                            "afterend",
                            progressRow
                        );

                    } else {

                        tierContent.prepend(
                            progressRow
                        );

                    }

                }

                /*
                 * Remove an old completion timestamp.
                 *
                 * We don't want duplicate timestamps.
                 */

                const oldCompletedAt =
                    progressRow.querySelector(
                        ".achievement-tier-completed-at"
                    );

                if (oldCompletedAt) {

                    oldCompletedAt.remove();

                }

                /*
                 * Create the new timestamp.
                 */

                const completedAtElement =
                    document.createElement(
                        "span"
                    );

                completedAtElement.className =
                    "achievement-tier-completed-at";

                completedAtElement.textContent =
                    formattedCompletedAt;

                progressRow.appendChild(
                    completedAtElement
                );

            }

            /*
             * ------------------------------------------
             * UNCOMPLETED
             * ------------------------------------------
             *
             * The achievement was just unchecked.
             *
             * Remove the Completed At display.
             */

            else {

                if (progressRow) {

                    const completedAtElement =
                        progressRow.querySelector(
                            ".achievement-tier-completed-at"
                        );

                    if (completedAtElement) {

                        completedAtElement.remove();

                    }

                    /*
                     * If there is no progress counter
                     * left in this row, remove the row too.
                     */

                    const hasProgress =
                        progressRow.querySelector(
                            ".achievement-tier-progress"
                        );

                    if (!hasProgress) {

                        progressRow.remove();

                    }

                }

            }

        }


        /*
         * ------------------------------------------
         * UPDATE ALL OTHER UI
         * ------------------------------------------
         */

        updateLockedTiers(item);
        updateAchievementProgress(item);

        updateCategoryProgress();
        updateCategoryHeaderProgress();
        updateOverallAchievementProgress();

    }

    function updateAchievementProgress(item) {

        const tiers =
            item.querySelectorAll(
                ".achievement-tier"
            );


        const completedTiers =
            item.querySelectorAll(
                ".achievement-tier.completed"
            );


        const totalTiers =
            tiers.length;


        const completedCount =
            completedTiers.length;


        const achievementTierCount =
            item.querySelector(
                ".achievement-tier-count"
            );

        if (achievementTierCount) {

            achievementTierCount.textContent =
                `${completedCount}/${totalTiers}`;

        }


        /*
         * Remove previous progress states.
         */

        item.classList.remove(
            "progress-low",
            "progress-high"
        );


        /*
         * Force the browser to register
         * the class removal so the animation
         * can restart when the new class is added.
         */

        void item.offsetWidth;


        /*
         * Do not apply progress colour
         * to a fully completed achievement.
         */

        if (
            totalTiers === 0 ||
            completedCount === totalTiers
        ) {
            return;
        }


        const progress =
            completedCount / totalTiers;


        /*
         * 1/3 complete.
         */

        if (
            progress >= 1 / 3 &&
            progress < 1 / 2
        ) {

            item.classList.add(
                "progress-low"
            );

        }


        /*
         * 1/2 complete or more,
         * but not fully completed.
         */

        else if (
            progress >= 1 / 2
        ) {

            item.classList.add(
                "progress-high"
            );

        }

    }

    function updateCategoryProgress() {

        if (!achievementData) {
            return;
        }


        /*
         * Recalculate every category from the
         * current tier completion state.
         */

        Object.entries(
            achievementData.categories
        ).forEach(
            ([category, data]) => {

                let completed = 0;


                achievementData.achievements.forEach(
                    achievement => {

                        if (
                            achievement.category !== category ||
                            !Array.isArray(
                                achievement.tiers
                            )
                        ) {
                            return;
                        }


                        achievement.tiers.forEach(
                            tier => {

                                if (
                                    tier.completed === true
                                ) {

                                    completed++;

                                }

                            }
                        );

                    }
                );


                data.completed = completed;

            }
        );


        /*
         * Rebuild the category cards.
         */

        buildCategories();


        if (
            browser &&
            !browser.hidden &&
            categoryTitle &&
            sidebarList
        ) {

            const currentCategory =
                categoryTitle.textContent;


            /*
             * Update the existing sidebar progress
             * bars instead of immediately destroying
             * and recreating them.
             */

            sidebarList
                .querySelectorAll(
                    ".achievement-sidebar-item"
                )
                .forEach(item => {

                    const categoryName =
                        item
                            .querySelector(
                                ".achievement-sidebar-name"
                            )
                            ?.textContent
                            .trim();


                    if (!categoryName) {
                        return;
                    }


                    const data =
                        achievementData.categories[
                            categoryName
                        ];


                    if (!data) {
                        return;
                    }


                    const progress =
                        data.total > 0
                            ? (
                                data.completed /
                                data.total
                            ) * 100
                            : 0;


                    const progressFill =
                        item.querySelector(
                            ".achievement-sidebar-progress-fill"
                        );


                    const count =
                        item.querySelector(
                            ".achievement-sidebar-progress-row small"
                        );


                    if (progressFill) {

                        progressFill.style.width =
                            `${progress}%`;

                    }


                    if (count) {

                        count.textContent =
                            `${data.completed}/${data.total}`;

                    }

                });


            /*
             * Keep the currently selected sidebar
             * category state intact.
             */

            const activeItem =
                sidebarList.querySelector(
                    ".achievement-sidebar-item.active"
                );


            if (
                !activeItem ||
                activeItem
                    .querySelector(
                        ".achievement-sidebar-name"
                    )
                    ?.textContent
                    .trim() !== currentCategory
            ) {

                buildSidebar(
                    currentCategory
                );

            }

        }

    }

    function updateLockedTiers(item) {

        const tiers =
            item.querySelectorAll(
                ".achievement-tier"
            );


        let previousCompleted = true;


        tiers.forEach(
            tier => {

                const button =
                    tier.querySelector(
                        ".achievement-complete-button"
                    );


                if (!button) {
                    return;
                }


                const isCompleted =
                    tier.classList.contains(
                        "completed"
                    );


                /*
                 * ------------------------------------------
                 * DETERMINE WHETHER THIS TIER IS LOCKED
                 * ------------------------------------------
                 */

                const locked =
                    !previousCompleted;


                tier.classList.toggle(
                    "locked",
                    locked
                );


                /*
                 * ------------------------------------------
                 * BUTTON STATE
                 * ------------------------------------------
                 *
                 * Do NOT use button.disabled.
                 *
                 * The button must remain clickable so our
                 * JavaScript can control the state.
                 */

                if (locked) {

                    button.setAttribute(
                        "aria-disabled",
                        "true"
                    );

                    button.title =
                        "Complete the previous tier first";

                } else {

                    button.removeAttribute(
                        "aria-disabled"
                    );

                    button.title =
                        isCompleted
                            ? "Mark Incomplete"
                            : "Mark Completed";

                }


                /*
                 * ------------------------------------------
                 * NEXT TIER
                 * ------------------------------------------
                 */

                previousCompleted =
                    isCompleted;

            }
        );


        /*
         * ------------------------------------------
         * LARGE ACHIEVEMENT ICON
         * ------------------------------------------
         */

        const mainIcon =
            item.querySelector(
                ".achievement-item-main-icon"
            );


        if (mainIcon) {

            const totalTiers =
                tiers.length;


            let highestCompletedTier = 0;


            tiers.forEach(
                tier => {

                    if (
                        tier.classList.contains(
                            "completed"
                        )
                    ) {

                        const tierNumber =
                            Number(
                                tier.dataset.tier
                            );


                        if (
                            tierNumber >
                            highestCompletedTier
                        ) {

                            highestCompletedTier =
                                tierNumber;

                        }

                    }

                }
            );


            mainIcon.src =
                getTierImage(
                    highestCompletedTier,
                    totalTiers
                );

            mainIcon.alt =
                `${highestCompletedTier}/${totalTiers}`;

        }


        /*
         * ------------------------------------------
         * WHOLE ACHIEVEMENT
         * ------------------------------------------
         */

        const allTiersCompleted =
            tiers.length > 0 &&
            Array.from(tiers).every(
                tier =>
                    tier.classList.contains(
                        "completed"
                    )
            );


        item.classList.toggle(
            "completed",
            allTiersCompleted
        );

    }


    function updateOverallAchievementProgress() {

        if (!achievementData) {
            return;
        }


        const countElement =
            document.getElementById(
                "achievement-overall-count"
            );


        const percentElement =
            document.getElementById(
                "achievement-overall-percent"
            );


        const progressFill =
            document.getElementById(
                "achievement-overall-progress-fill"
            );


        if (
            !countElement ||
            !percentElement ||
            !progressFill
        ) {
            return;
        }


        let totalAchievements = 0;
        let completedAchievements = 0;


        /*
         * Every tier counts as its own achievement.
         *
         * Example:
         *
         * Achievement A
         *   Tier 1
         *   Tier 2
         *   Tier 3
         *
         * = 3 total achievements
         */

        achievementData.achievements.forEach(
            achievement => {

                if (
                    !Array.isArray(
                        achievement.tiers
                    )
                ) {
                    return;
                }


                achievement.tiers.forEach(
                    tier => {

                        totalAchievements++;


                        if (
                            tier.completed === true
                        ) {

                            completedAchievements++;

                        }

                    }
                );

            }
        );


        /*
         * No achievements available.
         */

        if (totalAchievements === 0) {

            countElement.textContent =
                "0 / 0";

            percentElement.textContent =
                "0%";

            progressFill.style.width =
                "0%";

            return;

        }


        /*
         * Calculate percentage.
         */

        const percentage =
            (
                completedAchievements /
                totalAchievements
            ) * 100;


        /*
         * Update the number.
         */

        countElement.textContent =
            `${completedAchievements} / ${totalAchievements}`;


        /*
         * Update percentage.
         */

        percentElement.textContent =
            `${percentage.toFixed(1)}%`;


        /*
         * Update progress bar.

         */

        progressFill.style.width =
            `${percentage}%`;

    }


    function updateCategoryHeaderProgress() {

        if (
            !achievementData ||
            !categoryTitle ||
            !categoryPercent ||
            !categoryProgressFill
        ) {
            return;
        }


        const category =
            categoryTitle.textContent.trim();


        const achievements =
            achievementData.achievements.filter(
                achievement =>
                    achievement.category === category
            );


        let total = 0;
        let completed = 0;


        achievements.forEach(
            achievement => {

                if (
                    !Array.isArray(
                        achievement.tiers
                    )
                ) {
                    return;
                }


                achievement.tiers.forEach(
                    tier => {

                        total++;


                        if (
                            tier.completed === true
                        ) {

                            completed++;

                        }

                    }
                );

            }
        );


        const percentage =
            total > 0
                ? (completed / total) * 100
                : 0;


        const roundedPercentage =
            Math.round(
                percentage * 10
            ) / 10;


        categoryPercent.textContent =
            `${roundedPercentage}% (${completed}/${total})`;


        categoryProgressFill.style.width =
            `${percentage}%`;

    }


    /*
     * --------------------------------------------------
     * BACK TO CATEGORIES
     * --------------------------------------------------
     */

    function closeBrowser() {

        browser.hidden = true;

        categories.hidden = false;

    }


    if (backButton) {

        backButton.addEventListener(
            "click",
            closeBrowser
        );

    }


    /*
     * --------------------------------------------------
     * HTML ESCAPING
     * --------------------------------------------------
     *
     * Prevents achievement/category data
     * from being interpreted as HTML.
     */

    function escapeHTML(value) {

        const div =
            document.createElement("div");

        div.textContent =
            value ?? "";

        return div.innerHTML;

    }


    /*
     * --------------------------------------------------
     * INITIAL LOAD
     * --------------------------------------------------
     */

    loadAchievements();

};


document.addEventListener(
    "click",
    event => {

        document
            .querySelectorAll(
                ".custom-select.open"
            )
            .forEach(
                select => {

                    if (
                        !select.contains(
                            event.target
                        )
                    ) {

                        select.classList.remove(
                            "open"
                        );


                        const button =
                            select.querySelector(
                                ".custom-select-button"
                            );


                        if (button) {

                            button.setAttribute(
                                "aria-expanded",
                                "false"
                            );

                        }

                    }

                }
            );

    }
);


function tryInitAchievements() {

    if (
        document.getElementById(
            "achievement-categories"
        )
    ) {

        window.initAchievements();

    }

}


document.addEventListener(
    "DOMContentLoaded",
    tryInitAchievements
);