import pytest

from app.page_numbering import (
    Section,
    build_page_labels,
    build_toc_entries,
    compute_arabic_starts,
    to_roman,
)


def test_to_roman_matches_spec_examples():
    assert to_roman(1) == "i"
    assert to_roman(2) == "ii"
    assert to_roman(3) == "iii"


def test_to_roman_rejects_non_positive():
    with pytest.raises(ValueError):
        to_roman(0)


def test_spec_worked_example_section_18():
    # Cover = 1 physical page, TOC = 1 physical page, Technical = 4,
    # Company Profile = 7, Financial = 5 — the task spec's own example.
    sections = [
        Section("Technical Proposal", "/tmp/a.pdf", 4),
        Section("Company Profile", "/tmp/b.pdf", 7),
        Section("Financial Proposal", "/tmp/c.pdf", 5),
    ]
    starts = compute_arabic_starts(sections)
    assert starts == [1, 5, 12]

    entries = build_toc_entries(sections)
    assert [(e.label, e.page_number) for e in entries] == [
        ("Technical Proposal", 1),
        ("Company Profile", 5),
        ("Financial Proposal", 12),
    ]


def test_the_first_section_always_starts_at_arabic_1_regardless_of_source_page_numbers():
    # The whole point of section 16/18 — the source document's own
    # internal page numbers are irrelevant to the final numbering.
    sections = [Section("Whatever", "/tmp/a.pdf", 1)]
    assert compute_arabic_starts(sections) == [1]


def test_build_page_labels_cover_toc_and_content():
    labels = build_page_labels(has_cover=True, toc_page_count=1, main_content_page_count=4)
    assert labels == [None, "i", "1", "2", "3", "4"]


def test_build_page_labels_multi_page_toc():
    labels = build_page_labels(has_cover=True, toc_page_count=3, main_content_page_count=2)
    assert labels == [None, "i", "ii", "iii", "1", "2"]


def test_build_page_labels_no_cover():
    labels = build_page_labels(has_cover=False, toc_page_count=1, main_content_page_count=2)
    assert labels == ["i", "1", "2"]


def test_build_page_labels_rejects_negative_counts():
    with pytest.raises(ValueError):
        build_page_labels(has_cover=True, toc_page_count=-1, main_content_page_count=1)
