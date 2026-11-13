// "View Relevant Experience" detail (spec §27) — the actual evidence
// behind a match, built entirely from data already stored on the project
// and its keywords. Nothing here is generated/inferred; every line is a
// verbatim field.
import Modal from "../ui/Modal";

export default function RelevantExperienceModal({ project, queryText, matchedKeywords, servicesText, onClose }) {
  return (
    <Modal onClose={onClose} size="md">
      <Modal.Header title="Relevant Experience" subtitle={project.title} onClose={onClose} />
      <Modal.Body>
        <div className="fre-detail-block">
          <div className="fre-detail-label">Matching requirement</div>
          <div className="fre-detail-quote">&ldquo;{queryText}&rdquo;</div>
        </div>

        {servicesText && (
          <div className="fre-detail-block">
            <div className="fre-detail-label">Relevant services (Actual Services Provided by Staff)</div>
            <p className="fre-detail-text">{servicesText}</p>
          </div>
        )}

        {matchedKeywords.length > 0 && (
          <div className="fre-detail-block">
            <div className="fre-detail-label">Relevant keyword experience</div>
            {matchedKeywords.map((kw) => (
              <div key={kw.name} className="fre-detail-keyword">
                <div className="fre-detail-keyword-name">{kw.name}</div>
                {kw.description && <p className="fre-detail-text">&ldquo;{kw.description}&rdquo;</p>}
              </div>
            ))}
          </div>
        )}

        {!servicesText && matchedKeywords.length === 0 && (
          <p className="text-secondary text-sm">This project matched mainly on its overall project description.</p>
        )}
      </Modal.Body>
    </Modal>
  );
}
