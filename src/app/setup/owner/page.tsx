import { OwnerSetup } from "@/components/owner-setup";
import {
  localOwnerSetupEnabled,
  localSupabaseAccountCreationAllowed,
} from "@/domains/authentication/owner-bootstrap";
export const dynamic = "force-dynamic";
export default function Page() {
  return (
    <OwnerSetup
      enabled={localOwnerSetupEnabled()}
      localAccountCreation={localSupabaseAccountCreationAllowed()}
    />
  );
}
