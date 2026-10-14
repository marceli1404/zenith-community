# Audit engine

Audits make bounded, read-only requests to public pages and do not change the target website. The crawler follows same-origin links, applies response and page limits, and respects the site's robots guidance.

## Checks and scores

The engine groups repeated findings and scores Security, Accessibility, Performance, and Search/SEO from 100. Findings reduce their category score according to severity; the four category scores contribute equally to the overall score. Reliability findings remain separate from those category scores.

If the homepage returns HTTP 400 or higher, or the request cannot reach it, the overall score is 0/100 and the report includes a critical “Homepage unavailable” finding. Category scores remain available as observations; they are not presented as a complete assessment when the homepage cannot be assessed.

Automated checks cover a subset of possible issues. They are not a security penetration test, accessibility certification, or guarantee of search ranking or performance.
