"""
docs/status.md must agree with the repository.

The project kept three independent claims about what existed, and all three were
wrong in different directions. docs/settings-module-spec.md carried a checklist
of ticked boxes pointing at seven files under src/app/components/settings/ that
were never created — the feature lived in one 610-line file. docs/legal-and-consent.md
declared itself legally binding and promised Midtrans, WhatsApp and a refund
policy that have no code at all. And docs/saas-subscription-platform.md pointed
at backend/db/migrations/0005_saas_subscription.sql, a file that does not exist;
the highest migration is 0004.

A ticked box is worse than silence, because it tells the next person they may
skip the work. docs/status.md is the single source of truth for what exists, so
it gets the same treatment as .env.example: the claims are checked, not trusted.

These tests are deliberately narrow. They verify that every file path and every
relative link in the "sudah ada" and "keputusan" sections resolves, because
those two sections assert existence. The "belum ada" section asserts absence on
purpose, so it is excluded — and that exclusion is exactly why the two sections
are parsed separately rather than treated as one blob.
"""

import re
from pathlib import Path

DOCS = Path(__file__).resolve().parents[2] / "docs"
STATUS = DOCS / "status.md"
CONTEXT = DOCS.parent / "CONTEXT.md"
ADR_DIR = DOCS / "adr"
PLAN = DOCS / "saas-subscription-platform.md"
LEGAL = DOCS / "legal-and-consent.md"

# Sections whose backticked paths are claims of existence. The section that
# lists what is missing is deliberately not here.
CLAIMING_SECTIONS = ("## Yang Sudah Ada", "## Keputusan yang Sudah Disepakati")

# A backticked token that looks like a path or a line reference inside one.
PATH_RE = re.compile(
    r"`(?P<path>[A-Za-z0-9_./-]+\.(?:py|sql|ts|tsx|md|txt|yml|json))"
    r"(?::(?P<lines>\d+(?:-\d+)?))?`"
)
LINK_RE = re.compile(r"\]\((?P<target>[^)]+)\)")


def _section(text: str, heading: str) -> str:
    """Return the body of a markdown section, up to the next same-level heading."""
    start = text.find(heading)
    if start == -1:
        return ""
    rest = text[start + len(heading) :]
    end = rest.find("\n## ")
    return rest if end == -1 else rest[:end]


def _claimed_paths(text: str) -> list[str]:
    """Repo-relative paths asserted to exist in the claiming sections."""
    found: list[str] = []
    for heading in CLAIMING_SECTIONS:
        for match in PATH_RE.finditer(_section(text, heading)):
            path = match.group("path")
            # A bare filename is still repo-relative here; every path in those
            # sections is written from the repo root.
            found.append(path)
    return found


class TestStatusExists:
    def test_status_file_exists(self):
        assert STATUS.is_file(), "docs/status.md is the single source of truth for what exists"

    def test_claims_nothing_is_implementation_ready(self):
        """The old plan document claimed to be implementation-ready."""
        assert PLAN.is_file()
        assert "Implementation-Ready" not in PLAN.read_text(), (
            "the plan document still claims implementation-ready status; "
            "docs/status.md is where that is tracked"
        )

    def test_legal_document_is_not_marked_binding(self):
        assert LEGAL.is_file()
        head = "\n".join(LEGAL.read_text().splitlines()[:20])
        assert "Berlaku Sah & Mengikat" not in head, (
            "legal-and-consent.md still presents itself as legally binding while "
            "payments, notifications and the in-app consent gate do not exist"
        )


class TestClaimedPathsResolve:
    def test_status_cites_at_least_one_path(self):
        """Guards against the parser silently matching nothing."""
        assert _claimed_paths(STATUS.read_text()), "no paths parsed from status.md"

    def test_every_claimed_path_exists(self):
        missing = sorted(
            {
                p
                for p in _claimed_paths(STATUS.read_text())
                if not (DOCS.parent / p).exists()
            }
        )
        assert not missing, (
            f"docs/status.md claims these paths exist but they do not: {missing}. "
            "Either the path is wrong or the claim is premature."
        )

    def test_every_line_reference_is_within_the_file(self):
        """A drifted line number is a smaller lie than a missing file, but still a lie."""
        bad: list[str] = []
        for heading in CLAIMING_SECTIONS:
            body = _section(STATUS.read_text(), heading)
            for match in PATH_RE.finditer(body):
                lines = match.group("lines")
                if not lines:
                    continue
                target = DOCS.parent / match.group("path")
                if not target.is_file():
                    continue
                end = int(lines.split("-")[-1])
                count = len(target.read_text().splitlines())
                if end > count:
                    bad.append(f"{match.group('path')}:{lines} (file has {count} lines)")
        assert not bad, f"line references past end of file: {bad}"


class TestRelativeLinksResolve:
    def test_status_links_resolve(self):
        bad = [
            target
            for target in LINK_RE.findall(STATUS.read_text())
            if not target.startswith(("http://", "https://", "#"))
            and not (STATUS.parent / target).resolve().exists()
        ]
        assert not bad, f"docs/status.md links to files that do not exist: {bad}"

    def test_adr_index_links_resolve(self):
        index = ADR_DIR / "README.md"
        assert index.is_file(), "an ADR nobody can find is the same as no ADR"
        bad = [
            target
            for target in LINK_RE.findall(index.read_text())
            if target.endswith(".md") and not (ADR_DIR / target).resolve().exists()
        ]
        assert not bad, f"docs/adr/README.md links to missing ADRs: {bad}"

    def test_adr_index_numbers_match_filenames(self):
        """An index that labels 0004 as 0003 sends the reader to the wrong decision."""
        index = ADR_DIR / "README.md"
        mismatched = [
            f"label {label} -> {target}"
            for label, target in re.findall(
                r"\|\s*\[(\d{4})\]\((\d{4}-[^)]+\.md)\)", index.read_text()
            )
            if not target.startswith(label)
        ]
        assert not mismatched, f"ADR index numbers disagree with filenames: {mismatched}"

    def test_no_untracked_adr_file(self):
        """Every ADR on disk is reachable from the index."""
        indexed = set(LINK_RE.findall((ADR_DIR / "README.md").read_text()))
        orphans = sorted(
            p.name for p in ADR_DIR.glob("[0-9][0-9][0-9][0-9]-*.md")
            if p.name not in indexed
        )
        assert not orphans, f"ADR files not listed in docs/adr/README.md: {orphans}"


class TestPlanDocumentAgreesWithDecisions:
    """The contradictions that ADR-0001, 0002 and 0004 removed from the plan."""

    def test_no_orm_stack_claim(self):
        assert "SQLAlchemy" not in PLAN.read_text(), "ADR-0001 dropped the ORM; the plan still names it"

    def test_no_subscriber_role(self):
        plan = PLAN.read_text()
        assert "'subscriber'" not in plan and '"subscriber | admin"' not in plan, (
            "ADR-0002 removed subscriber as a role value; the plan still emits it"
        )

    def test_no_expiry_beat_task(self):
        """Access is derived, so no task marks anything expired.

        The task name still appears in the plan document, in the sentence that
        explains why it was cancelled. What must not survive is the scheduled
        entry that would have run it.
        """
        assert '"task": "workers.subscription_worker.check_and_expire' not in PLAN.read_text(), (
            "the expiry task is cancelled because access is derived from expires_at; "
            "it must not be reinstated in beat_schedule"
        )

    def test_no_bearer_jwt_claims(self):
        assert "sub_status" not in PLAN.read_text(), (
            "ADR-0004 replaced JWT claims with a database lookup on every request"
        )

    def test_signup_path_is_canonical(self):
        assert "register-checkout" not in PLAN.read_text(), (
            "the canonical registration path is /v1/auth/signup"
        )


class TestContextAndAdrsExist:
    def test_context_glossary_exists(self):
        assert CONTEXT.is_file(), "CONTEXT.md holds the vocabulary these docs depend on"

    def test_decisions_have_adrs(self):
        # Every decision status.md points at must resolve, which the link test
        # covers; this asserts the decisions exist as ADRs at all.
        found = sorted(p.name for p in ADR_DIR.glob("[0-9][0-9][0-9][0-9]-*.md"))
        assert len(found) >= 6, f"expected the accepted decisions to be written down, found {found}"