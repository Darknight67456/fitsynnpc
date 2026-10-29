"""Our tag names, and how DeepFashion's names map onto them.
Used by the training notebook and by the service, so both agree on the labels."""

PATTERNS = ['plain', 'striped', 'checked', 'floral', 'polka dot', 'graphic print']
FABRICS = ['cotton', 'denim', 'linen', 'silk', 'chiffon', 'knit', 'lace', 'leather', 'wool', 'polyester']
CATEGORIES = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory']
GARMENT_CATEGORIES = ['top', 'bottom', 'dress', 'outerwear']     # DeepFashion has no shoes or accessories
ACCESSORY_TYPES = ['bag', 'watch', 'ring', 'necklace', 'earrings', 'bracelet', 'brooch', 'neckwear',
                   'hat', 'hairwear', 'eyewear', 'gloves', 'legwear', 'belt']

OUTERWEAR_NAMES = {'anorak', 'blazer', 'bomber', 'cardigan', 'jacket', 'parka', 'peacoat', 'poncho', 'coat', 'cape'}
DRESS_TYPE_EXCEPT = {'cape', 'coverup'}                           # DeepFashion calls these "full body" but they are not dresses


def category_from_name(name: str, cloth_type: int):
    """DeepFashion category name + its type (1 upper, 2 lower, 3 full body) -> our category, or None."""
    n = name.strip().lower()
    if n in OUTERWEAR_NAMES:
        return 'outerwear'
    if cloth_type == 1:
        return 'top'
    if cloth_type == 2:
        return 'bottom'
    if cloth_type == 3 and n not in DRESS_TYPE_EXCEPT:
        return 'dress'
    return None


# keyword found in a DeepFashion attribute name -> our label (first match wins)
PATTERN_KEYWORDS = [
    ('stripe', 'striped'), ('check', 'checked'), ('plaid', 'checked'), ('gingham', 'checked'), ('houndstooth', 'checked'),
    ('floral', 'floral'), ('flower', 'floral'), ('polka', 'polka dot'), ('dot', 'polka dot'),
    ('graphic', 'graphic print'), ('print', 'graphic print'), ('letter', 'graphic print'), ('logo', 'graphic print'),
    ('abstract', 'graphic print'), ('animal', 'graphic print'), ('camo', 'graphic print'), ('tribal', 'graphic print'),
    ('paisley', 'graphic print'), ('tropical', 'graphic print'), ('geo', 'graphic print'),
]
FABRIC_KEYWORDS = [
    ('denim', 'denim'), ('chambray', 'denim'), ('linen', 'linen'), ('chiffon', 'chiffon'), ('lace', 'lace'),
    ('leather', 'leather'), ('silk', 'silk'), ('satin', 'silk'), ('wool', 'wool'), ('tweed', 'wool'),
    ('knit', 'knit'), ('sweater', 'knit'), ('crochet', 'knit'), ('cotton', 'cotton'), ('jersey', 'cotton'),
    ('poly', 'polyester'), ('nylon', 'polyester'),
]


def _first_match(attr_names, table):
    for keyword, label in table:
        if any(keyword in a.lower() for a in attr_names):
            return label
    return None


def pattern_from_attrs(texture_attr_names):
    """Names of the texture attributes an image HAS -> our pattern. No pattern attribute at all = 'plain'."""
    return _first_match(texture_attr_names, PATTERN_KEYWORDS) or 'plain'


def fabric_from_attrs(fabric_attr_names):
    """Names of the fabric attributes an image HAS -> our fabric, or None if none of ours is mentioned."""
    return _first_match(fabric_attr_names, FABRIC_KEYWORDS)
