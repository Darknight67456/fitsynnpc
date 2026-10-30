"""Run with:  python test_colortheory.py   (no AI models needed)"""
import colortheory as C


def test_schemes():
    assert C.scheme_of(['#000000', '#ffffff']) == 'neutral'
    assert C.scheme_of(['#1f3a93', '#d4a373']) == 'accent'              # one color on a neutral base
    assert C.scheme_of(['#2b4c9b', '#e08a1e']) == 'complementary'
    assert C.scheme_of(['#2b4c9b', '#3f8fd4']) == 'monochromatic'
    assert C.scheme_of(['#e8c53a', '#9b59b6', '#2ecc71']) == 'triadic'
    assert C.scheme_of(['#c0392b', '#27ae60', '#2b4c9b']) == 'multicolor'


def test_scores_order():
    safe = C.score_palette(['#1b2a4a', '#e8d5b0'])['score']
    loud = C.score_palette(['#c0392b', '#27ae60', '#2b4c9b'])['score']
    assert safe > loud


def test_undertone_changes_score():
    warm = C.score_palette(['#e08a1e', '#1b2a4a'], ['top', 'bottom'], 'warm')['score']
    cool = C.score_palette(['#e08a1e', '#1b2a4a'], ['top', 'bottom'], 'cool')['score']
    assert warm > cool


def test_match_groups_and_bad_colors():
    anchor = {'id': 'a', 'color': '#2b4c9b', 'category': 'top'}
    cands = [{'id': 'b', 'color': '#e8d5b0', 'category': 'bottom'}, {'id': 'x', 'color': 'nope', 'category': 'bottom'},
             {'id': 't', 'color': '#fff', 'category': 'top'}, {'id': 'w', 'color': '#d4af37', 'category': 'accessory', 'subtype': 'watch'}]
    groups = C.match(anchor, cands)
    names = [g['group'] for g in groups]
    assert names == ['bottom', 'watch']                                  # no other tops, bad color skipped
    assert [p['item_id'] for p in groups[0]['picks']] == ['b']


def test_weakest():
    items = [{'id': '1', 'color': '#1b2a4a', 'category': 'bottom'}, {'id': '2', 'color': '#c0392b', 'category': 'top'},
             {'id': '3', 'color': '#27ae60', 'category': 'shoes'}]
    assert C.check_outfit(items)['weakest'] is not None


def test_undertone_from_rgb():
    assert C.undertone_from_rgb((241, 194, 183))[0] == 'cool'            # pinkish
    assert C.undertone_from_rgb((198, 148, 92))[0] == 'warm'             # golden


if __name__ == '__main__':
    for name, fn in list(globals().items()):
        if name.startswith('test_'):
            fn()
            print('ok', name)
