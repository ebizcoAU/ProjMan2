import { NextResponse } from "next/server";
import { z } from "zod";
import { sendContactLead } from "@/lib/email";

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

  try {
    await sendContactLead(parsed.data);
  } catch (err) {
    console.error("Failed to send contact lead:", err);
    return NextResponse.json({ ok: false, error: "Could not send message. Please try again." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
