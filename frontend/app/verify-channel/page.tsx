import type { Metadata } from "next";
import { VerifyChannel } from "@/components/VerifyChannel";

export const metadata: Metadata = { title: "Confirm alert address", robots: { index: false } };
export default function Page() { return <VerifyChannel />; }
