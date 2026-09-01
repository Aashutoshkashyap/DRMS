"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 6) return setError("Password must be at least 6 characters.");
    if (password !== confirm) return setError("Passwords do not match.");
    setSaving(true);
    const { error: updateError } = await createClient().auth.updateUser({ password });
    setSaving(false);
    if (updateError) return setError(updateError.message);
    router.replace("/dashboard");
  }

  return <div className="flex min-h-screen items-center justify-center bg-background px-4">
    <Card className="w-full max-w-md border-border bg-card">
      <CardHeader><CardTitle>Set a new password</CardTitle><CardDescription>Choose a new password for your Disaster Relief Management System account.</CardDescription></CardHeader>
      <CardContent><form className="space-y-4" onSubmit={submit}>
        {error && <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600">{error}</p>}
        <div className="space-y-2"><Label htmlFor="password">New password</Label><Input id="password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
        <div className="space-y-2"><Label htmlFor="confirm">Confirm password</Label><Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></div>
        <Button className="w-full" disabled={saving}>{saving ? "Saving…" : "Save password"}</Button>
      </form></CardContent>
    </Card>
  </div>;
}
