from main import classify_block

def test_homeharvest_403_is_a_block():
    assert classify_block(RuntimeError("Response 403 Forbidden"), 0, 1.2) is True

def test_captcha_or_challenge_text_is_a_block():
    assert classify_block(RuntimeError("Access to this page has been denied / captcha"), 0, 0.5) is True

def test_empty_result_is_not_a_block():
    # A genuinely empty ZIP returns 0 rows quickly with no error.
    assert classify_block(None, 0, 0.8) is False

def test_normal_results_not_a_block():
    assert classify_block(None, 25, 3.0) is False
