import { useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { NavLink } from "react-router-dom";
import LangSwitcher from "./LangSwitcher";
import { canEdit } from "../lib/auth";

interface ShellNavigationProps {
  role: string;
  pendingCount: number;
  onImportRequest: () => void;
}

function draftLabel(pendingCount: number) {
  return (
    <>
      <span>Drafts</span>
      {pendingCount > 0 && (
        <span className="sn-count">
          {pendingCount > 99 ? "99+" : pendingCount}
        </span>
      )}
    </>
  );
}

function BrowseLinks({ mobile = false }: { mobile?: boolean }) {
  const linkClass = mobile
    ? ({ isActive }: { isActive: boolean }) =>
        `sn-menu__link ${isActive ? "is-active" : ""}`
    : ({ isActive }: { isActive: boolean }) =>
        `btn ${isActive ? "btn-active" : ""}`;

  return (
    <>
      <NavLink to="/" end className={linkClass}>
        Home
      </NavLink>
      <NavLink to="/side-quests" className={linkClass}>
        Side Quests
      </NavLink>
      <NavLink to="/categories" className={linkClass}>
        Grouped Texts
      </NavLink>
    </>
  );
}

function WorkLinks({
  mobile = false,
  pendingCount,
  canImport,
  onImportRequest,
}: {
  mobile?: boolean;
  pendingCount: number;
  canImport: boolean;
  onImportRequest: () => void;
}) {
  const linkClass = mobile
    ? ({ isActive }: { isActive: boolean }) =>
        `sn-menu__link ${isActive ? "is-active" : ""}`
    : ({ isActive }: { isActive: boolean }) =>
        `btn ${isActive ? "btn-active" : ""}`;

  return (
    <>
      <NavLink
        to="/drafts"
        className={linkClass}
        aria-label={`Drafts (${pendingCount} pending)`}
      >
        {draftLabel(pendingCount)}
      </NavLink>
      {canImport && (
        <NavLink to="/versions" className={linkClass}>
          Versions
        </NavLink>
      )}
      {canImport && (
        <button
          type="button"
          onClick={onImportRequest}
          className={mobile ? "sn-menu__link" : "btn"}
          title="Import from SQLite"
        >
          {mobile ? (
            "Import"
          ) : (
            <>
              <svg
                aria-hidden="true"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              <span>Import</span>
            </>
          )}
        </button>
      )}
    </>
  );
}

function OperationsLinks({ mobile = false }: { mobile?: boolean }) {
  const linkClass = mobile
    ? ({ isActive }: { isActive: boolean }) =>
        `sn-menu__link ${isActive ? "is-active" : ""}`
    : ({ isActive }: { isActive: boolean }) =>
        `btn ${isActive ? "btn-active" : ""}`;

  return (
    <NavLink to="/admin/logs" className={linkClass}>
      Logs
    </NavLink>
  );
}

export default function ShellNavigation({
  role,
  pendingCount,
  onImportRequest,
}: ShellNavigationProps) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const canImport = canEdit(role);

  function closeMenu() {
    setMenuOpen(false);
    window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>("summary")?.focus();
    });
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDetailsElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeMenu();
  }

  function handleMenuClick(event: MouseEvent<HTMLDetailsElement>) {
    if ((event.target as HTMLElement).closest("a, button")) closeMenu();
  }

  function handleImportRequest() {
    closeMenu();
    onImportRequest();
  }

  return (
    <>
      <nav className="sn-browse" aria-label="Browse archive">
        <span className="sn-nav-label">Browse</span>
        <div className="sn-nav-links">
          <BrowseLinks />
        </div>
      </nav>

      <div className="sn-tools" role="group" aria-label="Work and account controls">
        <div className="sn-tool-group" role="group" aria-label="Work">
          <span className="sn-tool-label">Work</span>
          <div className="sn-tool-links">
            <WorkLinks
              pendingCount={pendingCount}
              canImport={canImport}
              onImportRequest={onImportRequest}
            />
          </div>
        </div>
        {role === "admin" && (
          <div className="sn-tool-group" role="group" aria-label="Operations">
            <span className="sn-tool-label">Ops</span>
            <div className="sn-tool-links">
              <OperationsLinks />
            </div>
          </div>
        )}
        <LangSwitcher />
      </div>

      <details
        ref={menuRef}
        className="sn-menu"
        open={menuOpen}
        onToggle={(event) => setMenuOpen(event.currentTarget.open)}
        onKeyDown={handleMenuKeyDown}
        onClick={handleMenuClick}
      >
        <summary className="sn-menu__toggle">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          <span>Menu</span>
        </summary>
        <div className="sn-menu__panel">
          <section className="sn-menu__section" aria-labelledby="mobile-browse-heading">
            <h2 id="mobile-browse-heading" className="sn-menu__heading">Browse</h2>
            <nav className="sn-menu__nav" aria-label="Browse archive">
              <BrowseLinks mobile />
            </nav>
          </section>
          <section className="sn-menu__section" aria-labelledby="mobile-work-heading">
            <h2 id="mobile-work-heading" className="sn-menu__heading">Work</h2>
            <nav className="sn-menu__nav" aria-label="Work tools">
              <WorkLinks
                mobile
                pendingCount={pendingCount}
                canImport={canImport}
                onImportRequest={handleImportRequest}
              />
            </nav>
          </section>
          {role === "admin" && (
            <section className="sn-menu__section" aria-labelledby="mobile-operations-heading">
              <h2 id="mobile-operations-heading" className="sn-menu__heading">Operations</h2>
              <nav className="sn-menu__nav" aria-label="Operations tools">
                <OperationsLinks mobile />
              </nav>
            </section>
          )}
          <div className="sn-menu__language">
            <span>Language</span>
            <LangSwitcher />
          </div>
        </div>
      </details>
    </>
  );
}
