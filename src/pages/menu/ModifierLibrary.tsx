import { useState, type FormEvent } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { formatNaira } from "@contracts/money";
import type { ModifierGroupWithOptions } from "@/lib/menuTypes";
import { ArmButton } from "./ArmButton";

const inputCls =
  "mt-2 w-full border-b border-royal-line bg-transparent py-2 text-sm text-royal-cream placeholder:text-royal-dim/50 transition-colors focus:border-royal-accent focus:outline-none";
const labelCls =
  "text-[10px] font-semibold uppercase tracking-[0.25em] text-royal-dim";
const iconBtnCls =
  "border border-royal-line p-1.5 text-royal-dim transition-colors hover:border-royal-accent hover:text-royal-accent disabled:opacity-40";
const armedBtnCls =
  "border border-rose-500/60 p-1.5 text-[10px] uppercase tracking-[0.15em] text-rose-400";

function NewGroupForm({ onDone }: { onDone: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [selectionType, setSelectionType] = useState<"single" | "multi">("single");
  const [required, setRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = trpc.menu.createModifierGroup.useMutation({
    onSuccess: () => {
      utils.menu.modifierLibrary.invalidate();
      utils.menu.fullMenu.invalidate();
      onDone();
    },
    onError: (e) => setError(e.message),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        create.mutate({ name, selectionType, required });
      }}
      className="border border-royal-line bg-royal-bgsoft p-5"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-royal-accent">
        New modifier group
      </p>
      <div className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-3">
        <label className="block">
          <span className={labelCls}>Name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Size, Extras"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className={labelCls}>Selection</span>
          <select
            value={selectionType}
            onChange={(e) => setSelectionType(e.target.value as "single" | "multi")}
            className={`${inputCls} bg-royal-bgsoft`}
          >
            <option value="single" className="bg-royal-bgsoft">Pick one</option>
            <option value="multi" className="bg-royal-bgsoft">Pick many</option>
          </select>
        </label>
        <label className="flex items-end gap-2 pb-2">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            className="h-4 w-4 accent-royal-primary"
          />
          <span className="text-sm text-royal-dim">Cashier must choose</span>
        </label>
      </div>
      {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}
      <div className="mt-5 flex items-center gap-4">
        <button
          type="submit"
          disabled={create.isPending}
          className="flex h-10 items-center gap-2 rounded-full border border-royal-accent px-5 text-xs font-semibold uppercase tracking-[0.2em] text-royal-accent transition-colors hover:bg-royal-accent hover:text-royal-bg disabled:opacity-60"
        >
          {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Create group
        </button>
        <button
          type="button"
          onClick={onDone}
          className="text-xs uppercase tracking-[0.2em] text-royal-dim hover:text-royal-cream"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function OptionRow({
  option,
  canManage,
}: {
  option: ModifierGroupWithOptions["options"][number];
  canManage: boolean;
}) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(option.name);
  const [price, setPrice] = useState(String(option.priceDeltaKobo / 100));

  const update = trpc.menu.updateModifierOption.useMutation({
    onSuccess: () => {
      utils.menu.modifierLibrary.invalidate();
      utils.menu.fullMenu.invalidate();
      setEditing(false);
    },
  });
  const remove = trpc.menu.deleteModifierOption.useMutation({
    onSuccess: () => {
      utils.menu.modifierLibrary.invalidate();
      utils.menu.fullMenu.invalidate();
    },
  });

  if (editing) {
    return (
      <li className="flex items-end gap-3 border-b border-royal-line/50 py-2.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 border-b border-royal-accent bg-transparent py-1 text-sm text-royal-cream focus:outline-none"
        />
        <input
          type="number"
          min="0"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="w-24 border-b border-royal-line bg-transparent py-1 text-sm text-royal-cream focus:border-royal-accent focus:outline-none"
        />
        <button
          type="button"
          disabled={update.isPending}
          onClick={() =>
            update.mutate({
              id: option.id,
              name,
              priceDelta: Number.parseFloat(price) || 0,
            })
          }
          className="text-xs uppercase tracking-[0.15em] text-royal-accent hover:text-royal-cream"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-xs uppercase tracking-[0.15em] text-royal-dim hover:text-royal-cream"
        >
          Cancel
        </button>
      </li>
    );
  }

  return (
    <li className="group flex items-center gap-3 border-b border-royal-line/50 py-2.5 last:border-0">
      <span className={`flex-1 text-sm ${option.active ? "text-royal-cream" : "text-royal-dim line-through"}`}>
        {option.name}
      </span>
      <span className="text-xs text-royal-dim">
        {option.priceDeltaKobo > 0 ? `+${formatNaira(option.priceDeltaKobo)}` : "Free"}
      </span>
      {canManage && (
      <span className="flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          title="Edit option"
          onClick={() => setEditing(true)}
          className={iconBtnCls}
        >
          <Pencil className="h-3 w-3" strokeWidth={1.75} />
        </button>
        <ArmButton
          title="Delete option"
          className={iconBtnCls}
          armedClassName={armedBtnCls}
          onConfirm={() => remove.mutate({ id: option.id })}
        >
          <Trash2 className="h-3 w-3" strokeWidth={1.75} />
        </ArmButton>
      </span>
      )}
    </li>
  );
}

function GroupCard({ group, canManage }: { group: ModifierGroupWithOptions; canManage: boolean }) {
  const utils = trpc.useUtils();
  const [editingGroup, setEditingGroup] = useState(false);
  const [name, setName] = useState(group.name);
  const [selectionType, setSelectionType] = useState(group.selectionType);
  const [required, setRequired] = useState(group.required);
  const [optName, setOptName] = useState("");
  const [optPrice, setOptPrice] = useState("");

  const invalidate = () => {
    utils.menu.modifierLibrary.invalidate();
    utils.menu.fullMenu.invalidate();
  };
  const updateGroup = trpc.menu.updateModifierGroup.useMutation({
    onSuccess: () => {
      invalidate();
      setEditingGroup(false);
    },
  });
  const deleteGroup = trpc.menu.deleteModifierGroup.useMutation({
    onSuccess: invalidate,
  });
  const addOption = trpc.menu.addModifierOption.useMutation({
    onSuccess: () => {
      invalidate();
      setOptName("");
      setOptPrice("");
    },
  });

  function submitOption(e: FormEvent) {
    e.preventDefault();
    addOption.mutate({
      groupId: group.id,
      name: optName,
      priceDelta: Number.parseFloat(optPrice) || 0,
    });
  }

  return (
    <div className="border border-royal-line bg-royal-bgsoft">
      {/* Group header */}
      <div className="flex items-start justify-between gap-3 border-b border-royal-line px-5 py-4">
        <div>
          <p className="text-sm font-semibold text-royal-cream">{group.name}</p>
          <div className="mt-2 flex gap-2">
            <span className="border border-royal-line px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] text-royal-dim">
              {group.selectionType === "single" ? "Pick one" : "Pick many"}
            </span>
            <span
              className={`border px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] ${
                group.required
                  ? "border-royal-accent/50 text-royal-accent"
                  : "border-royal-line text-royal-dim"
              }`}
            >
              {group.required ? "Required" : "Optional"}
            </span>
          </div>
        </div>
        {canManage && (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            title="Edit group"
            onClick={() => setEditingGroup((v) => !v)}
            className={iconBtnCls}
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <ArmButton
            title="Delete group (removes it from all items)"
            className={iconBtnCls}
            armedClassName={armedBtnCls}
            onConfirm={() => deleteGroup.mutate({ id: group.id })}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          </ArmButton>
        </div>
        )}
      </div>

      {/* Inline group editor */}
      {editingGroup && (
        <div className="border-b border-royal-line bg-royal-faint/20 px-5 py-4">
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
            />
            <select
              value={selectionType}
              onChange={(e) => setSelectionType(e.target.value as "single" | "multi")}
              className={`${inputCls} bg-royal-bgsoft`}
            >
              <option value="single" className="bg-royal-bgsoft">Pick one</option>
              <option value="multi" className="bg-royal-bgsoft">Pick many</option>
            </select>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={required}
                onChange={(e) => setRequired(e.target.checked)}
                className="h-4 w-4 accent-royal-primary"
              />
              <span className="text-sm text-royal-dim">Required</span>
            </label>
          </div>
          <div className="mt-4 flex gap-4">
            <button
              type="button"
              disabled={updateGroup.isPending}
              onClick={() => updateGroup.mutate({ id: group.id, name, selectionType, required })}
              className="text-xs uppercase tracking-[0.2em] text-royal-accent hover:text-royal-cream"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditingGroup(false)}
              className="text-xs uppercase tracking-[0.2em] text-royal-dim hover:text-royal-cream"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Options */}
      <ul className="px-5 py-2">
        {group.options.length === 0 && (
          <li className="py-3 text-xs text-royal-dim/70">
            No options yet — add the choices below.
          </li>
        )}
        {group.options.map((opt) => (
          <OptionRow key={opt.id} option={opt} canManage={canManage} />
        ))}
      </ul>

      {/* Add option */}
      {canManage && (
      <form onSubmit={submitOption} className="flex items-end gap-3 border-t border-royal-line px-5 py-4">
        <label className="flex-1">
          <span className="text-[9px] uppercase tracking-[0.2em] text-royal-dim/70">
            New option
          </span>
          <input
            required
            value={optName}
            onChange={(e) => setOptName(e.target.value)}
            placeholder="e.g. Extra meat"
            className={inputCls}
          />
        </label>
        <label className="w-28">
          <span className="text-[9px] uppercase tracking-[0.2em] text-royal-dim/70">
            + ₦
          </span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={optPrice}
            onChange={(e) => setOptPrice(e.target.value)}
            placeholder="0"
            className={inputCls}
          />
        </label>
        <button
          type="submit"
          disabled={addOption.isPending}
          title="Add option"
          className={iconBtnCls}
        >
          {addOption.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </button>
      </form>
      )}
    </div>
  );
}

export function ModifierLibraryTab({ canManage }: { canManage: boolean }) {
  const library = trpc.menu.modifierLibrary.useQuery();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-lg text-sm leading-6 text-royal-dim">
          Modifier groups are the questions a cashier answers when selling an
          item — portion size, swallow choice, extras. Attach them to items
          from the item editor.
        </p>
        {canManage && (
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="flex shrink-0 items-center gap-2 rounded-full border border-royal-accent px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-royal-accent transition-colors hover:bg-royal-accent hover:text-royal-bg"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          New group
        </button>
        )}
      </div>

      {showCreate && canManage && <NewGroupForm onDone={() => setShowCreate(false)} />}

      {library.isLoading && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-royal-accent" strokeWidth={1.5} />
        </div>
      )}

      {library.data && library.data.length === 0 && !showCreate && (
        <div className="border border-dashed border-royal-line px-6 py-14 text-center">
          <p className="text-sm text-royal-dim">
            No modifier groups yet. Create one — e.g. “Portion”, “Swallow
            choice”, “Extras”.
          </p>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        {library.data?.map((g) => <GroupCard key={g.id} group={g} canManage={canManage} />)}
      </div>
    </div>
  );
}
