import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { encryptInventorySecret } from "@/domains/inventory/crypto";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export async function GET() {
  try {
    const staff = await requireStaff();
    if (
      !staff.permissions.has("inventory.read") &&
      !staff.permissions.has("inventory.manage")
    )
      throw new AppError("FORBIDDEN", "Inventory access required.", 403);
    const { data, error } = await staff.db
      .from("inventory_items")
      .select(
        "id,sku,title,category,status,created_at,inventory_reservations(id,order_id,released_at)",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (error)
      throw new AppError("QUERY_FAILED", "Inventory could not be loaded.", 500);
    return NextResponse.json(
      { items: data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const staff = await requireStaff("inventory.manage");
    const body = z
      .object({
        sku: z.string().trim().min(1).max(100),
        title: z.string().trim().min(1).max(200),
        category: z.string().trim().min(1).max(100),
        secret: z.string().min(1).max(4000).optional(),
      })
      .parse(await readBody(request));
    const { data, error } = await staff.db.rpc("create_inventory", {
      item_sku: body.sku,
      item_title: body.title,
      item_category: body.category,
      secret_ciphertext: body.secret
        ? encryptInventorySecret(body.secret)
        : null,
    });
    if (error)
      throw new AppError(
        "INVENTORY_REJECTED",
        "The item could not be created. Verify the SKU is unique.",
        409,
      );
    return NextResponse.json({ id: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
