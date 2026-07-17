// src/components/ui/Card.jsx

/**
 * Card, Card.Header, Card.Body, Card.Footer
 *
 * Usage:
 *  <Card>
 *    <Card.Header title="Users" action={<Button size="sm">Add</Button>} />
 *    <Card.Body>...</Card.Body>
 *    <Card.Footer>...</Card.Footer>
 *  </Card>
 */
function Card({ children, hoverable = false, className = "", style }) {
  return (
    <div className={`card${hoverable ? " card-hover" : ""} ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}

Card.Header = function CardHeader({ title, subtitle, action, children, className = "" }) {
  return (
    <div className={`card-header ${className}`.trim()}>
      <div>
        {title    && <h2>{title}</h2>}
        {subtitle && <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 2 }}>{subtitle}</p>}
        {children}
      </div>
      {action && <div className="card-header-action">{action}</div>}
    </div>
  );
};

Card.Body = function CardBody({ children, className = "", style }) {
  return (
    <div className={`card-body ${className}`.trim()} style={style}>
      {children}
    </div>
  );
};

Card.Footer = function CardFooter({ children, className = "" }) {
  return (
    <div className={`card-footer ${className}`.trim()}>
      {children}
    </div>
  );
};

export default Card;