/** The key label for the Activity "Who" column, minus a leading copy of the actor's name. */
export function keyDetail(actor: string, keyLabel: string | null | undefined): string | null {
  const label = keyLabel?.trim();
  if (!label) return null;
  if (!label.toLowerCase().startsWith(actor.toLowerCase())) return label;
  const rest = label.slice(actor.length).replace(/^[\s·:/-]+/u, '');
  return rest || null;
}
