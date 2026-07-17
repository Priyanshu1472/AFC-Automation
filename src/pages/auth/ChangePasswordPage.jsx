import SetPasswordForm from "./SetPasswordForm";
import logo from "../../images/Logo.png";
import "../../styles/Login.css";

// Reached via a forced redirect from ProtectedRoute when
// afc_users.must_change_password is true — e.g. right after an MD/DGM
// created the account with an auto-generated password.
export default function ChangePasswordPage() {
  return (
    <div className="login-page">
      <div className="login-brand" aria-hidden="true">
        <div className="login-brand-inner">
          <h1 className="login-brand-title">
            AFC India
            <br />
            Limited
          </h1>
          <p className="login-brand-sub">
            Agricultural Finance Corporation.
            <br />
            Serving India since 1968.
          </p>
          <div className="login-brand-rule" />
        </div>
      </div>

      <div className="login-form-panel">
        <div className="login-form-inner">
          <div className="login-logo-row">
            <img src={logo} height={52} alt="AFC India Limited logo" className="login-logo-img" />
            <div className="login-org-info">
              <div className="login-org-name">AFC India Limited</div>
            </div>
          </div>

          <SetPasswordForm
            heading="Set your password"
            subheading="For security, please choose your own password before continuing."
            submitLabel="Continue"
          />

          <p className="login-footer-note">© {new Date().getFullYear()} AFC India Limited. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
