import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import {
  decryptInventorySecret,
  inventoryKeyAvailable,
} from "@/domains/inventory/crypto";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const staff = await requireStaff("inventory.secrets.read");
    if (!inventoryKeyAvailable())
      throw new AppError(
        "ENCRYPTION_NOT_CONFIGURED",
        "Inventory decryption is not configured.",
        503,
      );
    const { item } = z
      .object({ item: z.uuid() })
      .parse(await readBody(request));
    const { data, error } = await staff.db.rpc("access_inventory_secret", {
      item,
    });
    if (error || typeof data !== "string")
      throw new AppError(
        "SECRET_UNAVAILABLE",
        "No authorized delivery data is available for this item.",
        403,
      );
    return NextResponse.json(
      { value: await decryptInventorySecret(data) },
      { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
