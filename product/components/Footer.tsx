import Link from "next/link";
import { company, footerLinks } from "@/lib/data";

export function Footer() {
  return (
    <footer className="border-t border-navy-100 bg-navy-800 text-navy-100">
      <div className="container-page grid gap-10 py-16 sm:grid-cols-2 lg:grid-cols-6">
        <div className="lg:col-span-2">
          <Link href="/" className="flex items-center gap-2 font-extrabold text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500 text-sm text-white">
              P
            </span>
            <span className="text-lg">ProjMan</span>
          </Link>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-navy-200">
            {company.valueProposition}
          </p>
          <p className="mt-6 text-xs text-navy-300">
            ProjMan is built by {company.legalName}, an Australian software
            development company operating since {company.tradingSince}.
          </p>
        </div>

        {Object.entries(footerLinks).map(([heading, links]) => (
          <div key={heading}>
            <h3 className="text-sm font-semibold text-white">{heading}</h3>
            <ul className="mt-4 space-y-3">
              {links.map((link) => (
                <li key={`${heading}-${link.label}`}>
                  <Link href={link.href} className="text-sm text-navy-200 hover:text-orange-400">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-navy-700">
        <div className="container-page flex flex-col gap-3 py-6 text-xs text-navy-300 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {company.legalName}. All rights reserved.
          </p>
          <p>{company.address}</p>
        </div>
      </div>
    </footer>
  );
}
