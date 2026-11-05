import pytest

from utils.hoyolab.material_kinds import material_kinds, material_name_key


@pytest.mark.parametrize(
    ("name", "category"),
    [
        ("Denial and Judgment", "Weekly boss drops"),
        ('"Tourbillon Device"', "Boss drops"),
        ("Artificed Spare Clockwork Component — Coppelia", "Boss drops"),
        ("Tile of Decarabian’s Tower", "Weapon ascension materials"),
        ("Revelry of the Cellared Spiritual Nectar", "Weapon ascension materials"),
        ("The Frost Emperor's Ceremony", "Weapon ascension materials"),
        ("Clarion of the Pale Star Army", "Weapon ascension materials"),
        ("Coiled Core of Life", "Elite enemy drops"),
        ("Accreted Growth", "Elite enemy drops"),
        ("Robust Fungal Nucleus", "Elite enemy drops"),
        ("Crystalline Cyst Dust", "Common enemy drops"),
        ("Luminescent Pollen", "Common enemy drops"),
        ("Prime Chimeric Nexus", "Common enemy drops"),
        ("Frostfairy Flower", "Local specialities"),
        ("Golden Fern", "Local specialities"),
        ("Vagabond's Cracked Sigil", "Boss drops"),
        ("Sundered Glory of the Far-North Scions", "Weapon ascension materials"),
    ],
)
def test_calculator_material_categories(name, category):
    assert material_kinds()[material_name_key(name)] == category
