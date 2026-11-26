import { useMemo, useState, type FormEvent } from "react";
import {
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { formatNaira } from "@contracts/money";
import type { MenuCategory, MenuItemWithGroups } from "@/lib/menuTypes";
import { ItemEditorModal } from "./menu/ItemEditorModal";
import { ModifierLibraryTab } from "./menu/ModifierLibrary";
import { ArmButton } from "./menu/ArmButton";
import { usePerms } from "@/lib/perms";

const iconBtnCls =
  "border border-royal-line p-1.5 text-royal-dim transition-colors hover:border-royal-accent hover:text-royal-accent disabled:opacity-40";
const armedBtnCls =
  "border border-rose-500/60 p-1.5 text-[10px] uppercase tracking-[0.15em] text-rose-400";

function AddCategoryForm({ onDone }: { onDone: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = trpc.menu.createCategory.useMutation({
    onSuccess: () => {
      utils.menu.fullMenu.invalidate();
      onDone();
    },
    onError: (e) => setError(e.message),
  });
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        setError(null);
        create.mutate({ name });
      }}
      className="px-3 py-3"
    >
      <input
        autoFocus
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Category name"
        className="w-full border-b border-royal-accent bg-transparent py-1.5 text-sm text-royal-cream placeholder:text-royal-dim/50 focus:outline-none"
      />
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
      <div className="mt-3 flex gap-3">
        <button
          type="submit"
          disabled={create.isPending}
          className="text-[10px] uppercase tracking-[0.2em] text-royal-accent hover:text-royal-cream"
        >
          {create.isPending ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="text-[10px] uppercase tracking-[0.2em] text-royal-dim hover:text-royal-cream"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function CategoryRow({
  category,
  selected,
  canManage,
  onSelect,
}: {
  category: MenuCategory;
  selected: boolean;
  canManage: boolean;
  onSelect: () => void;
}) {
  const utils = trpc.useUtils();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(category.name);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => utils.menu.fullMenu.invalidate();
  const rename = trpc.menu.renameCategory.useMutation({
    onSuccess: () => {
      invalidate();
      setRenaming(false);
    },
  });
  const setActive = trpc.menu.setCategoryActive.useMutation({
    onSuccess: invalidate,
  });
  const remove = trpc.menu.deleteCategory.useMutation({
    onSuccess: invalidate,
    onError: (e) => setError(e.message),
  });

  if (renaming) {
    return (
      <div className="px-3 py-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") rename.mutate({ id: category.id, name });
            if (e.key === "Escape") setRenaming(false);
          }}
          className="w-full border-b border-royal-accent bg-transparent py-1 text-sm text-royal-cream focus:outline-none"
        />
        <div className="mt-2 flex gap-3">
          <button
            type="button"
            onClick={() => rename.mutate({ id: category.id, name })}
            className="text-[10px] uppercase tracking-[0.2em] text-royal-accent"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setRenaming(false)}
            className="text-[10px] uppercase tracking-[0.2em] text-royal-dim"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-center gap-2 border-l-2 px-3 py-2.5 text-left text-sm transition-colors ${
          selected
            ? "border-royal-accent bg-royal-faint/40 text-royal-cream"
            : "border-transparent text-royal-dim hover:bg-royal-faint/20 hover:text-royal-cream"
        } ${category.active ? "" : "opacity-50"}`}
      >
        <span className="flex-1 truncate">{category.name}</span>
        <span className="text-[10px] text-royal-dim/60">
          {category.items.length}
        </span>
      </button>
      {canManage && (
      <span className="absolute right-7 top-1/2 hidden -translate-y-1/2 items-center gap-1 group-hover:flex">
        <button
          type="button"
          title="Rename"
          onClick={() => setRenaming(true)}
          className="p-1 text-royal-dim hover:text-royal-accent"
        >
          <Pencil className="h-3 w-3" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          title={category.active ? "Hide from POS" : "Show on POS"}
          onClick={() => setActive.mutate({ id: category.id, active: !category.active })}
          className="p-1 text-royal-dim hover:text-royal-accent"
        >
          {category.active ? (
            <EyeOff className="h-3 w-3" strokeWidth={1.75} />
          ) : (
            <Eye className="h-3 w-3" strokeWidth={1.75} />
          )}
        </button>
        <ArmButton
          title="Delete category"
          className="p-1 text-royal-dim hover:text-rose-400"
          armedClassName="p-1 text-[9px] uppercase text-rose-400"
          onConfirm={() => remove.mutate({ id: category.id })}
        >
          <Trash2 className="h-3 w-3" strokeWidth={1.75} />
        </ArmButton>
      </span>
      )}
      {error && (
        <p className="px-3 pb-2 text-[11px] leading-4 text-rose-300">{error}</p>
      )}
    </div>
  );
}

function ItemRow({
  item,
  canManage,
  onEdit,
}: {
  item: MenuItemWithGroups;
  canManage: boolean;
  onEdit: () => void;
}) {
  const utils = trpc.useUtils();
  const setAvailability = trpc.menu.setItemAvailability.useMutation({
    onSuccess: () => utils.menu.fullMenu.invalidate(),
  });
  const remove = trpc.menu.deleteItem.useMutation({
    onSuccess: () => utils.menu.fullMenu.invalidate(),
  });

  return (
    <tr className="group border-b border-royal-line/50 last:border-0 hover:bg-royal-faint/20">
      <td className="px-5 py-3.5">
        <p className={`text-sm ${item.available ? "text-royal-cream" : "text-royal-dim line-through"}`}>
          {item.name}
        </p>
        {item.description && (
          <p className="mt-0.5 text-xs text-royal-dim/80">{item.description}</p>
        )}
      </td>
      <td className="px-5 py-3.5 text-sm text-royal-cream">
        {formatNaira(item.priceKobo)}
      </td>
      <td className="px-5 py-3.5">
        <div className="flex max-w-[220px] flex-wrap gap-1">
          {item.modifierGroups.length === 0 ? (
            <span className="text-[10px] uppercase tracking-[0.15em] text-royal-dim/40">
              —
            </span>
          ) : (
            item.modifierGroups.map((g) => (
              <span
                key={g.id}
                className="border border-royal-line px-1.5 py-0.5 text-[9px] uppercase tracking-[0.15em] text-royal-dim"
              >
                {g.name}
                {g.required && <span className="text-royal-accent">*</span>}
              </span>
            ))
          )}
        </div>
      </td>
      <td className="px-5 py-3.5">
        {canManage ? (
        <button
          type="button"
          role="switch"
          aria-checked={item.available}
          title={item.available ? "Mark unavailable (sold out)" : "Mark available"}
          onClick={() =>
            setAvailability.mutate({ id: item.id, available: !item.available })
          }
          className={`relative h-5 w-9 rounded-full border transition-colors ${
            item.available
              ? "border-emerald-500/50 bg-emerald-500/20"
              : "border-royal-line bg-royal-faint/40"
          }`}
        >
          <span
            className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-all ${
              item.available
                ? "left-[calc(100%-1.125rem)] bg-emerald-400"
                : "left-0.5 bg-royal-dim"
            }`}
          />
        </button>
        ) : (
          <span
            className={`text-[10px] font-semibold uppercase tracking-[0.15em] ${
              item.available ? "text-emerald-300" : "text-royal-dim"
            }`}
          >
            {item.available ? "Available" : "Sold out"}
          </span>
        )}
      </td>
      {canManage && (
      <td className="px-5 py-3.5">
        <div className="flex items-center justify-end gap-1.5">
          <button type="button" title="Edit item" onClick={onEdit} className={iconBtnCls}>
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <ArmButton
            title="Delete item"
            className={iconBtnCls}
            armedClassName={armedBtnCls}
            onConfirm={() => remove.mutate({ id: item.id })}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          </ArmButton>
        </div>
      </td>
      )}
    </tr>
  );
}

export default function MenuPage() {
  const { has } = usePerms();
  const canManage = has("menu", "manage");
  const menu = trpc.menu.fullMenu.useQuery();
  const library = trpc.menu.modifierLibrary.useQuery();
  const [tab, setTab] = useState<"items" | "modifiers">("items");
  const [selectedCat, setSelectedCat] = useState<number | "all">("all");
  const [addingCategory, setAddingCategory] = useState(false);
  const [editor, setEditor] = useState<
    { item: MenuItemWithGroups | null } | null
  >(null);

  const categories = menu.data ?? [];
  const totalItems = useMemo(
    () => categories.reduce((sum, c) => sum + c.items.length, 0),
    [categories],
  );

  const visibleCategories =
    selectedCat === "all"
      ? categories
      : categories.filter((c) => c.id === selectedCat);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
            Menu management
          </p>
          <p className="mt-2 max-w-lg text-sm leading-6 text-royal-dim">
            {categories.length} categor{categories.length === 1 ? "y" : "ies"} ·{" "}
            {totalItems} item{totalItems === 1 ? "" : "s"} ·{" "}
            {library.data?.length ?? 0} modifier group
            {(library.data?.length ?? 0) === 1 ? "" : "s"}. Changes appear on
            the POS immediately.
          </p>
        </div>
        {tab === "items" && canManage && (
          <button
            type="button"
            onClick={() => setEditor({ item: null })}
            className="flex shrink-0 items-center gap-2 rounded-full border border-royal-accent px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-royal-accent transition-colors hover:bg-royal-accent hover:text-royal-bg"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            New item
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-6 border-b border-royal-line">
        {(
          [
            { key: "items", label: "Items" },
            { key: "modifiers", label: "Modifier library" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 pb-3 text-xs font-semibold uppercase tracking-[0.2em] transition-colors ${
              tab === t.key
                ? "border-royal-accent text-royal-cream"
                : "border-transparent text-royal-dim hover:text-royal-cream"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "modifiers" && <ModifierLibraryTab canManage={canManage} />}

      {tab === "items" && (
        <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
          {/* Category rail */}
          <div className="border border-royal-line">
            <div className="flex items-center justify-between border-b border-royal-line px-3 py-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.25em] text-royal-dim">
                Categories
              </span>
              {canManage && (
              <button
                type="button"
                title="Add category"
                onClick={() => setAddingCategory((v) => !v)}
                className="p-1 text-royal-dim transition-colors hover:text-royal-accent"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
              )}
            </div>
            {addingCategory && canManage && (
              <AddCategoryForm onDone={() => setAddingCategory(false)} />
            )}
            <button
              type="button"
              onClick={() => setSelectedCat("all")}
              className={`flex w-full items-center border-l-2 px-3 py-2.5 text-left text-sm transition-colors ${
                selectedCat === "all"
                  ? "border-royal-accent bg-royal-faint/40 text-royal-cream"
                  : "border-transparent text-royal-dim hover:bg-royal-faint/20 hover:text-royal-cream"
              }`}
            >
              <span className="flex-1">All items</span>
              <span className="text-[10px] text-royal-dim/60">{totalItems}</span>
            </button>
            {categories.map((c) => (
              <CategoryRow
                key={c.id}
                category={c}
                selected={selectedCat === c.id}
                canManage={canManage}
                onSelect={() => setSelectedCat(c.id)}
              />
            ))}
          </div>

          {/* Items */}
          <div className="space-y-6">
            {menu.isLoading && (
              <div className="flex justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-royal-accent" strokeWidth={1.5} />
              </div>
            )}

            {menu.isError && (
              <p className="border border-royal-line px-5 py-10 text-center text-sm text-rose-300">
                {menu.error.message}
              </p>
            )}

            {menu.data && visibleCategories.length === 0 && (
              <div className="border border-dashed border-royal-line px-6 py-14 text-center">
                <p className="text-sm text-royal-dim">
                  No categories yet — add one from the left rail.
                </p>
              </div>
            )}

            {visibleCategories.map((cat) =>
              cat.items.length === 0 && selectedCat !== "all" ? (
                <div
                  key={cat.id}
                  className="border border-dashed border-royal-line px-6 py-14 text-center"
                >
                  <p className="text-sm text-royal-dim">
                    “{cat.name}” is empty. Add the first item.
                  </p>
                </div>
              ) : (
                <div key={cat.id} className="border border-royal-line">
                  <div className="flex items-center justify-between border-b border-royal-line px-5 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-royal-dim">
                      {cat.name}
                      {!cat.active && (
                        <span className="ml-2 text-royal-accent/70">(hidden from POS)</span>
                      )}
                    </p>
                    <span className="text-[10px] text-royal-dim/60">
                      {cat.items.length} item{cat.items.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  {cat.items.length > 0 && (
                    <div className="royal-scroll overflow-x-auto">
                      <table className="w-full min-w-[640px] text-left">
                        <thead>
                          <tr className="border-b border-royal-line text-[10px] uppercase tracking-[0.2em] text-royal-dim/70">
                            <th className="px-5 py-3 font-semibold">Item</th>
                            <th className="px-5 py-3 font-semibold">Price</th>
                            <th className="px-5 py-3 font-semibold">Modifiers</th>
                            <th className="px-5 py-3 font-semibold">Available</th>
                            {canManage && <th className="px-5 py-3 text-right font-semibold">Actions</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {cat.items.map((item) => (
                            <ItemRow
                              key={item.id}
                              item={item}
                              canManage={canManage}
                              onEdit={() => setEditor({ item })}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ),
            )}
          </div>
        </div>
      )}

      {/* Item editor modal */}
      {editor && menu.data && canManage && (
        <ItemEditorModal
          categories={menu.data}
          modifierLibrary={library.data ?? []}
          initial={editor.item}
          defaultCategoryId={selectedCat === "all" ? undefined : selectedCat}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
