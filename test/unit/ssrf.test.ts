import { describe, it, expect } from "vitest";
import {
  validatePublicTarget,
  parseIPv4,
  classifyIPv4,
  classifyIPv6,
  ensureScheme,
} from "@shared/ssrf";

function expectBlocked(input: string) {
  const r = validatePublicTarget(input);
  expect(r.ok, `expected "${input}" to be BLOCKED but it was allowed`).toBe(false);
  return r;
}
function expectAllowed(input: string) {
  const r = validatePublicTarget(input);
  expect(r.ok, `expected "${input}" to be ALLOWED but it was blocked`).toBe(true);
  return r;
}

describe("ensureScheme", () => {
  it("prepends https:// to bare hosts", () => {
    expect(ensureScheme("example.com")).toBe("https://example.com");
    expect(ensureScheme("example.com:8080/x")).toBe("https://example.com:8080/x");
  });
  it("leaves explicit schemes intact", () => {
    expect(ensureScheme("http://example.com")).toBe("http://example.com");
    expect(ensureScheme("javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(ensureScheme("file:///etc/passwd")).toBe("file:///etc/passwd");
  });
});

describe("parseIPv4 (inet_aton semantics)", () => {
  it("parses dotted decimal", () => {
    expect(parseIPv4("127.0.0.1")).toBe(0x7f000001);
    expect(parseIPv4("8.8.8.8")).toBe(0x08080808);
  });
  it("parses integer form", () => {
    expect(parseIPv4("2130706433")).toBe(0x7f000001); // 127.0.0.1
  });
  it("parses hex form", () => {
    expect(parseIPv4("0x7f000001")).toBe(0x7f000001);
    expect(parseIPv4("0x7f.0.0.1")).toBe(0x7f000001);
  });
  it("parses octal form", () => {
    expect(parseIPv4("0177.0.0.1")).toBe(0x7f000001);
  });
  it("parses short forms", () => {
    expect(parseIPv4("127.1")).toBe(0x7f000001); // 127.0.0.1
    expect(parseIPv4("10.1")).toBe(0x0a000001);
  });
  it("rejects non-IPv4 strings", () => {
    expect(parseIPv4("example.com")).toBeNull();
    expect(parseIPv4("256.0.0.1")).toBeNull();
    expect(parseIPv4("1.2.3.4.5")).toBeNull();
    expect(parseIPv4("10..1")).toBeNull();
  });
});

describe("classifyIPv4", () => {
  it("flags private and reserved ranges", () => {
    expect(classifyIPv4(parseIPv4("10.0.0.5")!)).toBe("private_network");
    expect(classifyIPv4(parseIPv4("172.16.0.1")!)).toBe("private_network");
    expect(classifyIPv4(parseIPv4("172.31.255.255")!)).toBe("private_network");
    expect(classifyIPv4(parseIPv4("192.168.1.1")!)).toBe("private_network");
    expect(classifyIPv4(parseIPv4("127.0.0.1")!)).toBe("loopback");
    expect(classifyIPv4(parseIPv4("169.254.169.254")!)).toBe("link_local");
    expect(classifyIPv4(parseIPv4("0.0.0.0")!)).toBe("unspecified");
    expect(classifyIPv4(parseIPv4("100.64.0.1")!)).toBe("reserved");
    expect(classifyIPv4(parseIPv4("255.255.255.255")!)).toBe("reserved");
  });
  it("allows genuine public addresses", () => {
    expect(classifyIPv4(parseIPv4("8.8.8.8")!)).toBeNull();
    expect(classifyIPv4(parseIPv4("1.1.1.1")!)).toBeNull();
    expect(classifyIPv4(parseIPv4("172.32.0.1")!)).toBeNull(); // just outside 172.16/12
  });
});

describe("classifyIPv6", () => {
  it("flags loopback, unspecified, link-local, ULA", () => {
    expect(classifyIPv6("::1")).toBe("loopback");
    expect(classifyIPv6("::")).toBe("unspecified");
    expect(classifyIPv6("fe80::1")).toBe("link_local");
    expect(classifyIPv6("fc00::1")).toBe("unique_local");
    expect(classifyIPv6("fd00::1")).toBe("unique_local");
  });
  it("flags IPv4-mapped private addresses", () => {
    expect(classifyIPv6("::ffff:127.0.0.1")).toBe("loopback");
    expect(classifyIPv6("::ffff:10.0.0.1")).toBe("private_network");
    expect(classifyIPv6("::ffff:169.254.169.254")).toBe("link_local");
  });
  it("blocks IPv4-compatible and non-global IPv6 ranges", () => {
    expect(classifyIPv6("::8.8.8.8")).toBe("ipv6_not_public");
    expect(classifyIPv6("64:ff9b::7f00:1")).toBe("ipv6_not_public");
    expect(classifyIPv6("100::1")).toBe("ipv6_not_public");
    expect(classifyIPv6("5f00::1")).toBe("ipv6_not_public");
  });
  it("blocks special-purpose ranges inside global unicast", () => {
    expect(classifyIPv6("2001:2::1")).toBe("reserved");
    expect(classifyIPv6("2001:db8::1")).toBe("reserved");
    expect(classifyIPv6("2002:7f00:1::")).toBe("reserved");
    expect(classifyIPv6("3fff::1")).toBe("reserved");
  });
  it("allows a public IPv6", () => {
    expect(classifyIPv6("2606:4700:4700::1111")).toBe("public");
    expect(classifyIPv6("2001:4860:4860::8888")).toBe("public");
  });
});

describe("validatePublicTarget — the hard security gate", () => {
  const blocked = [
    "http://localhost/",
    "http://localhost:80/",
    "http://LOCALHOST/",
    "http://127.0.0.1/",
    "http://127.0.0.1./", // trailing-dot FQDN
    "http://0.0.0.0/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://10.10.10.10/",
    "http://10.0.0.1/",
    "http://172.16.0.1/",
    "http://172.20.1.1/",
    "http://192.168.0.1/",
    "http://169.254.169.254/", // cloud metadata
    "http://[fe80::1]/",
    "http://[fd00::1]/",
    "http://2130706433/", // integer -> 127.0.0.1
    "http://0x7f000001/", // hex -> 127.0.0.1
    "http://0177.0.0.1/", // octal -> 127.0.0.1
    "http://127.1/", // short form
    "http://user:pass@example.com/", // credentials
    "http://example.com:22/", // non-standard port
    "http://example.com:8080/", // non-standard port
    "ftp://example.com/", // scheme
    "file:///etc/passwd", // scheme
    "javascript:alert(1)", // scheme
    "gopher://example.com/", // scheme
    "http://metadata.google.internal/", // metadata hostname
    "http://foo.localhost/", // localhost suffix
    "http://service.internal/", // internal suffix
    "not a url",
    "http://[::ffff:192.168.1.1]/",
    "http://[64:ff9b::7f00:1]/", // NAT64 translation prefix
    "http://[2001:db8::1]/", // documentation prefix
    "http://[2002:7f00:1::]/", // 6to4 can embed IPv4 addresses
    "http://[3fff::1]/", // documentation prefix
    "http://[::8.8.8.8]/", // deprecated IPv4-compatible form
  ];
  for (const input of blocked) {
    it(`blocks ${input}`, () => expectBlocked(input));
  }

  const allowed = [
    "example.com",
    "https://example.com",
    "http://example.com/",
    "https://example.com:443/path?q=1",
    "http://example.com:80/",
    "https://sub.domain.example.co.uk/page",
  ];
  for (const input of allowed) {
    it(`allows ${input}`, () => {
      const r = expectAllowed(input);
      if (r.ok) expect(r.port === 80 || r.port === 443).toBe(true);
    });
  }

  it("rejects public IP literals with the Cloudflare fetch limitation", () => {
    for (const input of ["https://8.8.8.8/", "https://[2606:4700:4700::1111]/"]) {
      const result = validatePublicTarget(input);
      expect(result).toMatchObject({
        ok: false,
        code: "ip_literal_not_supported",
      });
      if (!result.ok) expect(result.reason).toContain("Enter the site's hostname instead");
    }
  });
});
