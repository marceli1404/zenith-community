"""SQLite integration checks: python -m unittest discover -s test/backend."""
import pathlib
import re
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]


class DashboardQueries(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
          CREATE TABLE sites(id TEXT, user_id TEXT, name TEXT, created_at INTEGER);
          CREATE TABLE audit_jobs(id TEXT, user_id TEXT);
          CREATE TABLE audit_results(id TEXT, audit_job_id TEXT, site_id TEXT, created_at INTEGER,
            overall_score INTEGER, security_score INTEGER, accessibility_score INTEGER,
            performance_score INTEGER, seo_score INTEGER, categories_assessed INTEGER DEFAULT 1);
          CREATE TABLE findings(audit_result_id TEXT, rule_id TEXT, title TEXT, severity TEXT);
          CREATE TABLE monitors(site_id TEXT, enabled INTEGER, next_check_at INTEGER, last_ok INTEGER, last_checked_at INTEGER);
          CREATE TABLE uptime_checks(site_id TEXT, checked_at INTEGER, ok INTEGER);
          CREATE TABLE incidents(site_id TEXT, resolved_at INTEGER);
        """)
        self.db.executemany("INSERT INTO sites VALUES(?,?,?,0)", [
            ("a", "owner", "A"), ("b", "owner", "B"), ("c", "owner", "C"), ("private", "other", "Private")])

    def result(self, identifier, site, timestamp, user="owner", score=80):
        self.db.execute("INSERT INTO audit_jobs VALUES(?,?)", (identifier, user))
        self.db.execute("INSERT INTO audit_results(id,audit_job_id,site_id,created_at,overall_score,security_score,accessibility_score,performance_score,seo_score) VALUES(?,?,?,?,?,?,?,?,?)",
                        (identifier, identifier, site, timestamp, score, score-1, score-2, score-3, score-4))

    def finding(self, result, rule, severity):
        self.db.execute("INSERT INTO findings VALUES(?,?,?,?)", (result, rule, rule, severity))

    def attention(self):
        source = (ROOT / "src/routes/dashboard.ts").read_text(encoding="utf-8")
        sql = re.search(r"export const ATTENTION_SQL = `([\s\S]*?)`;", source).group(1)
        return self.db.execute(sql, ("owner",)).fetchall()

    def site_snapshot_sql(self):
        source = (ROOT / "src/routes/sites.ts").read_text(encoding="utf-8")
        sql = re.search(r"`(SELECT s\.\*,[\s\S]*?)`", source).group(1)
        def display_score(alias):
            return f"""CASE WHEN EXISTS (
              SELECT 1 FROM findings score_finding
              WHERE score_finding.audit_result_id = {alias}.id
                AND score_finding.rule_id = 'reliability.homepage-unavailable'
            ) THEN 0 ELSE {alias}.overall_score END"""
        return sql.replace('${displayOverallScoreSql("latest")}', display_score("latest")).replace('${displayOverallScoreSql("ar")}', display_score("ar"))

    def test_current_results_ownership_grouping_and_coverage(self):
        self.result("old", "a", 1)
        self.finding("old", "resolved", "critical")
        self.result("new", "a", 2)
        self.finding("new", "current", "high")
        self.finding("new", "current", "low")
        self.result("clean", "b", 2)
        self.result("private", "private", 5, "other")
        self.finding("private", "private", "critical")
        # Defensive ownership check also excludes mismatched job ownership.
        self.result("mismatch", "a", 10, "other")
        self.finding("mismatch", "private", "critical")
        rows = self.attention()
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["rule_id"], rows[0]["occurrences"]), ("current", 2))
        self.assertEqual((rows[0]["total_sites"], rows[0]["audited_sites"]), (3, 2))

    def test_empty_findings_retains_unknown_coverage(self):
        row = self.attention()[0]
        self.assertIsNone(row["site_id"])
        self.assertEqual((row["total_sites"], row["audited_sites"], row["total_findings"]), (3, 0, 0))

    def test_bound_and_critical_priority(self):
        self.result("new", "a", 2)
        for i in range(25):
            self.finding("new", f"rule{i:02}", "critical" if i == 24 else "high")
        rows = self.attention()
        self.assertEqual(len(rows), 20)
        self.assertEqual(rows[0]["rule_id"], "rule24")
        self.assertEqual(rows[0]["total_findings"], 25)

    def test_site_snapshot_fields_share_latest_result(self):
        self.result("old", "a", 1, score=70)
        self.result("new", "a", 2, score=90)
        rows = self.db.execute(self.site_snapshot_sql(), (0, 0, "owner")).fetchall()
        row = next(r for r in rows if r["id"] == "a")
        self.assertEqual((row["latest_score"], row["latest_audit_id"], row["latest_audit_at"]), (90, "new", 2))
        self.assertEqual((row["security_score"], row["previous_score"]), (89, 70))
        self.assertIsNone(next(r for r in rows if r["id"] == "c")["latest_score"])

    def test_site_snapshot_exposes_homepage_unavailability_for_latest_result(self):
        self.result("down", "a", 4, score=0)
        self.finding("down", "reliability.homepage-unavailable", "critical")
        row = next(r for r in self.db.execute(self.site_snapshot_sql(), (0, 0, "owner")).fetchall() if r["id"] == "a")
        self.assertEqual((row["latest_score"], row["homepage_unavailable"]), (0, 1))


if __name__ == "__main__":
    unittest.main()
