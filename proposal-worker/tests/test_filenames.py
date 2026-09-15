from app.filenames import is_safe_relative_path, output_base_name, output_filename, sanitize_filename


def test_sanitize_filename_strips_unsafe_characters():
    assert sanitize_filename('a/b\\c:d*e?f"g<h>i|j') == "a_b_c_d_e_f_g_h_i_j"


def test_sanitize_filename_collapses_runs_and_strips_leading_dots():
    assert sanitize_filename("../../etc/passwd") == "etc_passwd"


def test_sanitize_filename_never_returns_empty():
    assert sanitize_filename("") != ""
    assert sanitize_filename("   ") != ""
    assert sanitize_filename("...") != ""


def test_sanitize_filename_caps_length():
    assert len(sanitize_filename("a" * 500)) <= 150


def test_output_filename_prefers_client_name():
    assert output_filename("Smart City Corp", "DPR for Smart City") == "Smart_City_Corp_Final.pdf"


def test_output_filename_falls_back_to_title_when_no_client():
    assert output_filename(None, "DPR for Smart City") == "DPR_for_Smart_City_Final.pdf"


def test_output_filename_falls_back_to_generic_when_nothing_usable():
    assert output_filename("", "") == "Proposal_Final.pdf"
    assert output_filename(None, None) == "Proposal_Final.pdf"


def test_output_filename_docx_shares_the_same_base_name_as_pdf():
    assert output_base_name("Smart City Corp", "DPR for Smart City") == "Smart_City_Corp_Final"
    assert output_filename("Smart City Corp", "DPR for Smart City", "pdf") == "Smart_City_Corp_Final.pdf"
    assert output_filename("Smart City Corp", "DPR for Smart City", "docx") == "Smart_City_Corp_Final.docx"


def test_is_safe_relative_path_accepts_normal_paths():
    assert is_safe_relative_path("prop-1/technical_doc-1.docx") is True


def test_is_safe_relative_path_rejects_traversal_and_absolute_paths():
    assert is_safe_relative_path("../../etc/passwd") is False
    assert is_safe_relative_path("/etc/passwd") is False
    assert is_safe_relative_path("a/../../b") is False
    assert is_safe_relative_path("") is False
    assert is_safe_relative_path("a\x00b") is False
