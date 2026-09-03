import { NextResponse } from "next/server";
import { z } from "zod";

const contactSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  company: z.string().min(1),
  role: z.string().min(1),
  message: z.string().min(1),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = contactSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid submission." }, { status: 400 });
  }

  // Lead is validated here. Wiring to the CRM / HubSpot / email pipeline
  // (see marketing integration in the site brief) is a deployment-time step.
  console.log("New ProjMan lead:", parsed.data);

  return NextResponse.json({ ok: true });
}
