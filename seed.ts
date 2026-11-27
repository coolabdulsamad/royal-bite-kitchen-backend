import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import {
  categories,
  itemModifierGroups,
  menuItems,
  modifierGroups,
  modifierOptions,
  settings,
  users,
} from "./schema";

/**
 * Initial data for Royal Bite Kitchen.
 * Safe to re-run: existing staff usernames are skipped, and the demo menu
 * is only inserted when the categories table is completely empty.
 */
async function seed() {
  const db = getDb();

  // ---------------------------------------------------------------- staff ---
  console.log("Seeding staff accounts...");
  const accounts = [
    {
      staffCode: "RB-000",
      name: "Super Admin",
      username: "superadmin",
      secret: "Royal@2026",
      role: "superadmin" as const,
    },
    {
      staffCode: "RB-001",
      name: "Demo Manager",
      username: "manager",
      secret: "Manager@2026",
      role: "manager" as const,
    },
    {
      staffCode: "RB-101",
      name: "Demo Cashier",
      username: "cashier",
      secret: "1234",
      role: "sales" as const,
    },
  ];

  for (const account of accounts) {
    const existing = await db.query.users.findFirst({
      where: (table, { eq }) => eq(table.username, account.username),
    });
    if (existing) {
      console.log(`- ${account.username} already exists, skipped`);
      continue;
    }
    await db.insert(users).values({
      staffCode: account.staffCode,
      name: account.name,
      username: account.username,
      secretHash: bcrypt.hashSync(account.secret, 10),
      role: account.role,
    });
    console.log(`+ ${account.username} (${account.role}) created`);
  }

  // ----------------------------------------------------------------- menu ---
  const anyCategory = await db.query.categories.findFirst();
  if (anyCategory) {
    console.log("- menu already seeded, skipped");
    console.log("Done.");
    process.exit(0);
  }

  console.log("Seeding demo menu...");

  // Modifier library
  const [portion] = await db
    .insert(modifierGroups)
    .values({ name: "Portion", selectionType: "single", required: true })
    .$returningId();
  const [swallow] = await db
    .insert(modifierGroups)
    .values({ name: "Swallow choice", selectionType: "single", required: true })
    .$returningId();
  const [extras] = await db
    .insert(modifierGroups)
    .values({ name: "Extras", selectionType: "multi", required: false })
    .$returningId();

  await db.insert(modifierOptions).values([
    { groupId: portion.id, name: "Regular", priceDeltaKobo: 0 },
    { groupId: portion.id, name: "Large", priceDeltaKobo: 70000 },
  ]);
  await db.insert(modifierOptions).values([
    { groupId: swallow.id, name: "Pounded Yam", priceDeltaKobo: 0 },
    { groupId: swallow.id, name: "Eba", priceDeltaKobo: 0 },
    { groupId: swallow.id, name: "Semo", priceDeltaKobo: 0 },
    { groupId: swallow.id, name: "Fufu", priceDeltaKobo: 0 },
  ]);
  await db.insert(modifierOptions).values([
    { groupId: extras.id, name: "Extra meat", priceDeltaKobo: 150000 },
    { groupId: extras.id, name: "Extra fish", priceDeltaKobo: 300000 },
    { groupId: extras.id, name: "Fried plantain", priceDeltaKobo: 100000 },
    { groupId: extras.id, name: "Moi-moi", priceDeltaKobo: 120000 },
  ]);

  // Categories + items
  const menu: Array<{
    name: string;
    items: Array<{
      name: string;
      description?: string;
      price: number; // kobo
      groups?: number[]; // modifier group ids
    }>;
  }> = [
    {
      name: "Rice & Grains",
      items: [
        { name: "Jollof Rice", description: "Smoky party-style jollof", price: 250000, groups: [portion.id, extras.id] },
        { name: "Fried Rice", description: "With mixed vegetables", price: 250000, groups: [portion.id, extras.id] },
        { name: "Jollof & Fried Combo", price: 280000, groups: [portion.id, extras.id] },
        { name: "White Rice & Stew", description: "With assorted beef stew", price: 200000, groups: [portion.id, extras.id] },
        { name: "Ofada Rice & Ayamase", description: "Local rice with green pepper sauce", price: 350000, groups: [portion.id, extras.id] },
      ],
    },
    {
      name: "Soups & Swallow",
      items: [
        { name: "Egusi Soup + Swallow", description: "Melon seed soup, assorted meat", price: 350000, groups: [swallow.id, extras.id] },
        { name: "Ogbono Soup + Swallow", description: "Draw soup with stockfish", price: 320000, groups: [swallow.id, extras.id] },
        { name: "Afang Soup + Swallow", price: 380000, groups: [swallow.id, extras.id] },
        { name: "Okra Soup + Swallow", description: "Fresh okra, assorted meat", price: 300000, groups: [swallow.id, extras.id] },
        { name: "Efo Riro + Swallow", description: "Rich spinach stew", price: 350000, groups: [swallow.id, extras.id] },
      ],
    },
    {
      name: "Proteins",
      items: [
        { name: "Peppered Chicken", price: 400000 },
        { name: "Peppered Turkey", price: 650000 },
        { name: "Grilled Croaker Fish", price: 500000 },
        { name: "Assorted Beef", price: 150000 },
        { name: "Peppered Snail", price: 450000 },
      ],
    },
    {
      name: "Drinks",
      items: [
        { name: "Chapman", description: "Royal Bite special mocktail", price: 180000 },
        { name: "Fresh Orange Juice", price: 150000 },
        { name: "Zobo", description: "Chilled hibiscus drink", price: 80000 },
        { name: "Soft Drink", description: "Coke, Fanta or Sprite", price: 80000 },
        { name: "Bottled Water", price: 50000 },
      ],
    },
  ];

  let sortCategory = 0;
  for (const cat of menu) {
    sortCategory += 1;
    const [newCat] = await db
      .insert(categories)
      .values({ name: cat.name, sortOrder: sortCategory })
      .$returningId();
    let sortItem = 0;
    for (const item of cat.items) {
      sortItem += 1;
      const [newItem] = await db
        .insert(menuItems)
        .values({
          categoryId: newCat.id,
          name: item.name,
          description: item.description ?? null,
          priceKobo: item.price,
          sortOrder: sortItem,
        })
        .$returningId();
      for (const [i, groupId] of (item.groups ?? []).entries()) {
        await db
          .insert(itemModifierGroups)
          .values({ itemId: newItem.id, groupId, sortOrder: i });
      }
    }
    console.log(`+ category "${cat.name}" (${cat.items.length} items)`);
  }

  // ------------------------------------------------- receipt/business info ---
  // Printed at the top of every receipt — seed sensible defaults when unset.
  console.log("Seeding business settings...");
  const businessDefaults: Array<[string, string]> = [
    ["business_address", "12 Adeola Odeku Street, Victoria Island, Lagos"],
    ["business_phone", "0800 000 1234"],
  ];
  for (const [key, value] of businessDefaults) {
    const [row] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1);
    if (!row) {
      await db.insert(settings).values({ key, value });
      console.log(`+ setting ${key}`);
    } else if (row.value.trim() === "") {
      await db.update(settings).set({ value }).where(eq(settings.key, key));
      console.log(`~ setting ${key} (was empty)`);
    }
  }

  console.log("Done.");
  process.exit(0);
}

seed();
