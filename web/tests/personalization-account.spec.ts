import { describe, expect, it } from "vitest";
import { PERSONALIZATION_GROUPS } from "@/components/space/dashboard-groups";
import { locatePage, pageSections } from "@/components/sidebar/page-sections";

describe("personalization account hub", () => {
  it("leads with the account's profile and password", () => {
    const account = PERSONALIZATION_GROUPS[0];
    expect(account.label.en).toBe("Account");
    const byHref = new Map(account.items.map((item) => [item.href, item]));
    expect(byHref.get("/profile")?.title.en).toBe("Profile");
    // The forced-password-change entry point stays one click away.
    expect(byHref.get("/profile?change=1")?.title.en).toBe("Password");
  });

  it("keeps Profile inside the account-level personalization shelf", () => {
    const sections = pageSections({
      t: (key) => key,
      zh: false,
      allowedSurfaces: null,
      isAvailable: () => true,
    });
    const located = locatePage("/profile", sections);
    expect(located?.section.id).toBe("personalization");
    expect(located?.page.account).toBe(true);
  });
});