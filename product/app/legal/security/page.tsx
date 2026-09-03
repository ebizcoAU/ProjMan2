import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { company } from "@/lib/data";

export const metadata: Metadata = {
  title: "Security",
  description: "How ProjMan protects evidence integrity and platform security.",
};

export default function SecurityPage() {
  return (
    <LegalPage title="Security" updated="1 September 2026">
      <p>
        Evidence integrity is the core promise of ProjMan. Every capture is geolocated,
        timestamped, and cryptographically hashed at the point of creation, so records cannot be
        silently altered after the fact.
      </p>
      <p>
        Access to project and evidence data is governed by role-based permissions, with
        multi-party verification requirements enforced at hold points throughout the 18-stage
        lifecycle.
      </p>
      <p>
        To report a security concern, contact {company.email}. We take all reports seriously and
        will respond promptly.
      </p>
      <p className="text-navy-400">
        This is a summary placeholder. A full security and compliance disclosure, including
        infrastructure and data-handling detail, will be published prior to public launch.
      </p>
    </LegalPage>
  );
}
