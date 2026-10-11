import { Suspense } from "react";
import { AuthForm } from "@/components/forms";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="skeleton mx-auto h-96 max-w-md rounded-3xl" />}>
      <AuthForm />
    </Suspense>
  );
}
