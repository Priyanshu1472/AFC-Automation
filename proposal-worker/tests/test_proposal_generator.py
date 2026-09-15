from unittest.mock import MagicMock

import pytest

from app import proposal_generator
from app.pdf_assembler import page_count
from tests.test_pdf_assembler import _make_pdf


def test_run_job_orchestrates_download_convert_assemble_upload(monkeypatch):
    fake_client = MagicMock()

    pdf_source_bytes = _make_pdf(2, "A")
    converted_bytes = _make_pdf(3, "B")
    uploaded = {}

    def fake_download(client, storage_path, dest):
        # Only the PDF item is downloaded as real bytes; the DOCX item's
        # bytes don't matter since conversion itself is mocked below.
        dest.write_bytes(pdf_source_bytes if storage_path.endswith(".pdf") else b"docx placeholder")

    def fake_convert(input_path, output_dir):
        out = output_dir / f"{input_path.stem}.pdf"
        out.write_bytes(converted_bytes)
        return out

    def fake_upload(client, path, data):
        uploaded["path"] = path
        uploaded["data"] = data

    monkeypatch.setattr(proposal_generator.supabase_client, "download_source_file", fake_download)
    monkeypatch.setattr(proposal_generator, "convert_to_pdf", fake_convert)
    monkeypatch.setattr(proposal_generator.supabase_client, "upload_final_pdf", fake_upload)
    monkeypatch.setattr(
        proposal_generator.supabase_client,
        "get_proposal_and_lead",
        lambda client, proposal_id: ({"id": proposal_id}, {"title": "Test Proposal", "client_name": "Acme Corp"}),
    )

    job = {
        "id": "job-1",
        "proposal_id": "prop-1",
        "selected_items": [
            {"source": "document", "source_id": "doc-1", "label": "Technical Proposal", "file_name": "technical.pdf", "file_path": "prop-1/technical.pdf", "ext": "pdf"},
            {"source": "ba", "source_id": "ba-1", "label": "Company Profile", "file_name": "profile.docx", "file_path": "prop-1/profile.docx", "ext": "docx"},
        ],
    }

    name, path, size = proposal_generator.run_job(fake_client, job)

    assert name == "Acme_Corp_Final.pdf"
    assert path == uploaded["path"]
    assert path.startswith("prop-1/final/job-1_")
    assert size == len(uploaded["data"])
    # 1 cover + TOC (>=1) + 2 (pdf item) + 3 (converted docx item).
    assert page_count(uploaded["data"]) >= 1 + 1 + 2 + 3


def test_run_job_rejects_empty_selection():
    fake_client = MagicMock()
    with pytest.raises(proposal_generator.GenerationError):
        proposal_generator.run_job(fake_client, {"id": "job-1", "proposal_id": "prop-1", "selected_items": []})


def test_run_job_wraps_conversion_failure_as_generation_error(monkeypatch):
    fake_client = MagicMock()

    def fake_download(client, storage_path, dest):
        dest.write_bytes(b"whatever")

    def fake_convert(input_path, output_dir):
        raise proposal_generator.ConversionError("LibreOffice choked on it.")

    monkeypatch.setattr(proposal_generator.supabase_client, "download_source_file", fake_download)
    monkeypatch.setattr(proposal_generator, "convert_to_pdf", fake_convert)
    monkeypatch.setattr(
        proposal_generator.supabase_client,
        "get_proposal_and_lead",
        lambda client, proposal_id: ({"id": proposal_id}, {"title": "T", "client_name": "C"}),
    )

    job = {
        "id": "job-1",
        "proposal_id": "prop-1",
        "selected_items": [
            {"source": "document", "source_id": "doc-1", "label": "Technical Proposal", "file_name": "technical.docx", "file_path": "prop-1/technical.docx", "ext": "docx"},
        ],
    }
    with pytest.raises(proposal_generator.GenerationError, match="Unable to convert"):
        proposal_generator.run_job(fake_client, job)


def test_run_job_cleans_up_its_temp_directory_even_on_failure(monkeypatch, tmp_path):
    fake_client = MagicMock()
    captured_dir = {}

    real_mkdtemp = proposal_generator.tempfile.mkdtemp

    def spy_mkdtemp(*args, **kwargs):
        d = real_mkdtemp(*args, **kwargs)
        captured_dir["path"] = d
        return d

    monkeypatch.setattr(proposal_generator.tempfile, "mkdtemp", spy_mkdtemp)
    monkeypatch.setattr(
        proposal_generator.supabase_client,
        "get_proposal_and_lead",
        lambda client, proposal_id: ({"id": proposal_id}, {"title": "T", "client_name": "C"}),
    )

    def fake_download(client, storage_path, dest):
        raise RuntimeError("storage is down")

    monkeypatch.setattr(proposal_generator.supabase_client, "download_source_file", fake_download)

    job = {
        "id": "job-1",
        "proposal_id": "prop-1",
        "selected_items": [
            {"source": "document", "source_id": "doc-1", "label": "Technical Proposal", "file_name": "technical.pdf", "file_path": "prop-1/technical.pdf", "ext": "pdf"},
        ],
    }
    with pytest.raises(RuntimeError):
        proposal_generator.run_job(fake_client, job)

    from pathlib import Path

    assert not Path(captured_dir["path"]).exists()
