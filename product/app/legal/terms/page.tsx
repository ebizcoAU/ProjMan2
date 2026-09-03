import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { company } from "@/lib/data";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms governing use of the ProjMan platform and website.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="1 September 2026">
      <p>
        These terms govern your access to and use of the ProjMan website and platform, operated
        by {company.legalName}. By creating an account or using ProjMan, you agree to these
        terms.
      </p>
      <p>
        ProjMan is provided on a subscription basis under the plan selected at sign-up. Evidence
        captured through the platform is retained as an immutable record for the purposes of
        project compliance, dispute resolution, and credentialing.
      </p>
      <p>
        For questions about these terms, or to request an enterprise agreement, contact us at{" "}
        {company.email}.
      </p>
      <p className="text-navy-400">
        This is a summary placeholder. Full terms of service will be published prior to public
        launch.
      </p>
    </LegalPage>
  );
}
