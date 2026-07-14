// Compress raw API objects into compact, Claude-friendly summaries

export interface CompactDeal {
  id: number;
  title: string;
  status: string;
  stage_id: number | null;
  pipeline_id: number | null;
  value: number | null;
  currency: string | null;
  person_id: number | null;
  org_id: number | null;
  owner_id: number | null;
  expected_close_date: string | null;
  stage_change_time: string | null;
  days_in_stage: number | null;
  update_time: string | null;
  custom_fields_resolved?: Array<{ key: string; label: string; value: unknown; display_value: string }>;
}

export interface CompactPerson {
  id: number;
  name: string;
  emails: string[];
  phones: string[];
  org_id: number | null;
  owner_id: number | null;
  update_time: string | null;
  custom_fields_resolved?: Array<{ key: string; label: string; value: unknown; display_value: string }>;
}

export interface CompactOrganization {
  id: number;
  name: string;
  address: string | null;
  owner_id: number | null;
  update_time: string | null;
  custom_fields_resolved?: Array<{ key: string; label: string; value: unknown; display_value: string }>;
}

export interface CompactActivity {
  id: number;
  subject: string;
  type: string;
  done: boolean;
  due_date: string | null;
  due_time: string | null;
  deal_id: number | null;
  person_id: number | null;
  org_id: number | null;
  user_id: number | null;
  update_time: string | null;
}

export interface CompactNote {
  id: number;
  content: string;
  deal_id: number | null;
  person_id: number | null;
  org_id: number | null;
  lead_id: string | null;
  user_id: number | null;
  pinned_to_deal_flag: boolean;
  pinned_to_person_flag: boolean;
  pinned_to_organization_flag: boolean;
  update_time: string | null;
}

function extractEmails(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((e: Record<string, unknown>) => e.value as string)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
}

function extractPhones(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((p: Record<string, unknown>) => p.value as string)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
}

// Parse a Pipedrive timestamp to epoch ms. Handles v2 ISO ("2026-03-23T18:45:37Z")
// and v1 space-separated UTC ("2026-03-23 18:45:37", no zone designator). Pipedrive
// timed values are UTC, so a bare datetime is normalised to UTC before parsing.
function parsePipedriveTime(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value);
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  const normalised = hasZone ? iso : `${iso}Z`;
  const ms = Date.parse(normalised);
  return Number.isNaN(ms) ? null : ms;
}

// Whole days elapsed since `stage_change_time`, floored, never negative.
// null when the deal has no stage_change_time (e.g. never moved stage).
function daysInStage(stageChangeTime: unknown): number | null {
  const changed = parsePipedriveTime(stageChangeTime);
  if (changed === null) return null;
  const elapsedMs = Date.now() - changed;
  if (elapsedMs < 0) return 0;
  return Math.floor(elapsedMs / 86_400_000);
}

export function compactDeal(raw: Record<string, unknown>): CompactDeal {
  return {
    id: raw.id as number,
    title: (raw.title as string) ?? "",
    status: (raw.status as string) ?? "open",
    stage_id: (raw.stage_id as number) ?? null,
    pipeline_id: (raw.pipeline_id as number) ?? null,
    value: (raw.value as number) ?? null,
    currency: (raw.currency as string) ?? null,
    person_id: (raw.person_id as number) ?? null,
    org_id: (raw.org_id as number) ?? null,
    owner_id: (raw.owner_id as number) ?? (raw.user_id as number) ?? null,
    expected_close_date: (raw.expected_close_date as string) ?? null,
    stage_change_time: (raw.stage_change_time as string) ?? null,
    days_in_stage: daysInStage(raw.stage_change_time),
    update_time: (raw.update_time as string) ?? null,
  };
}

export function compactPerson(raw: Record<string, unknown>): CompactPerson {
  return {
    id: raw.id as number,
    name: (raw.name as string) ?? "",
    emails: extractEmails(raw.emails ?? raw.email),
    phones: extractPhones(raw.phones ?? raw.phone),
    org_id: (raw.org_id as number) ?? null,
    owner_id: (raw.owner_id as number) ?? (raw.user_id as number) ?? null,
    update_time: (raw.update_time as string) ?? null,
  };
}

export function compactOrganization(raw: Record<string, unknown>): CompactOrganization {
  return {
    id: raw.id as number,
    name: (raw.name as string) ?? "",
    address: (raw.address as string) ?? null,
    owner_id: (raw.owner_id as number) ?? (raw.user_id as number) ?? null,
    update_time: (raw.update_time as string) ?? null,
  };
}

export function compactActivity(raw: Record<string, unknown>): CompactActivity {
  return {
    id: raw.id as number,
    subject: (raw.subject as string) ?? "",
    type: (raw.type as string) ?? "",
    done: (raw.done as boolean) ?? false,
    due_date: (raw.due_date as string) ?? null,
    due_time: (raw.due_time as string) ?? null,
    deal_id: (raw.deal_id as number) ?? null,
    person_id: (raw.person_id as number) ?? null,
    org_id: (raw.org_id as number) ?? null,
    user_id: (raw.owner_id as number) ?? (raw.user_id as number) ?? null,
    update_time: (raw.update_time as string) ?? null,
  };
}

export interface CompactNoteComment {
  uuid: string;
  content: string;
  user_id: number | null;
  updater_id: number | null;
  active_flag: boolean;
  add_time: string | null;
  update_time: string | null;
}

export interface CompactMailThread {
  id: number;
  subject: string;
  snippet: string | null;
  message_count: number;
  read_flag: boolean;
  archived_flag: boolean;
  shared_flag: boolean;
  has_draft_flag: boolean;
  deal_id: number | null;
  lead_id: string | null;
  from_emails: string[];
  to_emails: string[];
  update_time: string | null;
}

export interface CompactMailMessage {
  id: number;
  subject: string;
  from_name: string | null;
  from_email: string;
  to_emails: string[];
  cc_emails: string[];
  body: string | null;
  has_body_flag: boolean;
  has_attachments_flag: boolean;
  draft_flag: boolean;
  read_flag: boolean;
  message_time: string | null;
  add_time: string | null;
}

function extractMailPartyEmails(parties: unknown, role: string): string[] {
  if (!parties || typeof parties !== "object") return [];
  const group = (parties as Record<string, unknown>)[role];
  if (!Array.isArray(group)) return [];
  return group
    .map((e: Record<string, unknown>) => e.email_address as string)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
}

function extractMailRecipientEmails(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((r: Record<string, unknown>) => ((r as Record<string, unknown>).email_address as string) ?? "")
    .filter((v) => v.length > 0);
}

export function compactNoteComment(raw: Record<string, unknown>): CompactNoteComment {
  return {
    uuid: (raw.uuid as string) ?? "",
    content: (raw.content as string) ?? "",
    user_id: (raw.user_id as number) ?? null,
    updater_id: (raw.updater_id as number) ?? null,
    active_flag: (raw.active_flag as boolean) ?? true,
    add_time: (raw.add_time as string) ?? null,
    update_time: (raw.update_time as string) ?? null,
  };
}

export function compactMailThread(raw: Record<string, unknown>): CompactMailThread {
  return {
    id: raw.id as number,
    subject: (raw.subject as string) ?? "",
    snippet: (raw.snippet as string) ?? null,
    message_count: (raw.message_count as number) ?? 0,
    read_flag: Boolean(raw.read_flag),
    archived_flag: Boolean(raw.archived_flag),
    shared_flag: Boolean(raw.shared_flag),
    has_draft_flag: Boolean(raw.has_draft_flag),
    deal_id: (raw.deal_id as number) ?? null,
    lead_id: (raw.lead_id as string) ?? null,
    from_emails: extractMailPartyEmails(raw.parties, "from").length > 0
      ? extractMailPartyEmails(raw.parties, "from")
      : extractMailPartyEmails(raw.drafts_parties, "from"),
    to_emails: extractMailPartyEmails(raw.parties, "to").length > 0
      ? extractMailPartyEmails(raw.parties, "to")
      : extractMailPartyEmails(raw.drafts_parties, "to"),
    update_time: (raw.update_time as string) ?? null,
  };
}

export function compactMailMessage(raw: Record<string, unknown>): CompactMailMessage {
  const fromList = raw.from as Array<Record<string, unknown>> | undefined;
  const firstFrom = Array.isArray(fromList) && fromList.length > 0 ? fromList[0] : null;
  return {
    id: raw.id as number,
    subject: (raw.subject as string) ?? "",
    from_name: firstFrom ? ((firstFrom.name as string) ?? null) : null,
    from_email: firstFrom ? ((firstFrom.email_address as string) ?? "") : "",
    to_emails: extractMailRecipientEmails(raw.to),
    cc_emails: extractMailRecipientEmails(raw.cc),
    body: (raw.body as string) ?? null,
    has_body_flag: Boolean(raw.has_body_flag),
    has_attachments_flag: Boolean(raw.has_attachments_flag),
    draft_flag: Boolean(raw.draft_flag),
    read_flag: Boolean(raw.read_flag),
    message_time: (raw.message_time as string) ?? null,
    add_time: (raw.add_time as string) ?? null,
  };
}

export interface CompactProject {
  id: number;
  title: string;
  status: string | null;
  board_id: number | null;
  phase_id: number | null;
  owner_id: number | null;
  start_date: string | null;
  end_date: string | null;
  deal_ids: number[];
  person_ids: number[];
  org_ids: number[];
  label_ids: number[];
  archive_time: string | null;
  update_time: string | null;
  custom_fields_resolved?: Array<{ key: string; label: string; value: unknown; display_value: string }>;
}

export interface CompactProjectTask {
  id: number;
  title: string;
  project_id: number | null;
  parent_task_id: number | null;
  assignee_id: number | null;
  done: boolean;
  milestone: boolean;
  due_date: string | null;
  marked_as_done_time: string | null;
  update_time: string | null;
}

export interface CompactBoard {
  id: number;
  name: string;
  order_nr: number | null;
  update_time: string | null;
}

export interface CompactPhase {
  id: number;
  name: string;
  board_id: number | null;
  order_nr: number | null;
  update_time: string | null;
}

export interface CompactProjectTemplate {
  id: number;
  title: string;
  description: string | null;
  owner_id: number | null;
  update_time: string | null;
}

function extractIdArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "number" ? v : parseInt(String(v), 10)))
    .filter((n) => !Number.isNaN(n));
}

export function compactProject(raw: Record<string, unknown>): CompactProject {
  return {
    id: raw.id as number,
    title: (raw.title as string) ?? "",
    status: (raw.status as string) ?? null,
    board_id: (raw.board_id as number) ?? null,
    phase_id: (raw.phase_id as number) ?? null,
    owner_id: (raw.owner_id as number) ?? null,
    start_date: (raw.start_date as string) ?? null,
    end_date: (raw.end_date as string) ?? null,
    deal_ids: extractIdArray(raw.deal_ids),
    person_ids: extractIdArray(raw.person_ids),
    org_ids: extractIdArray(raw.org_ids),
    label_ids: extractIdArray(raw.label_ids),
    archive_time: (raw.archive_time as string) ?? null,
    update_time: (raw.update_time as string) ?? null,
  };
}

export function compactProjectTask(raw: Record<string, unknown>): CompactProjectTask {
  return {
    id: raw.id as number,
    title: (raw.title as string) ?? "",
    project_id: (raw.project_id as number) ?? null,
    parent_task_id: (raw.parent_task_id as number) ?? null,
    assignee_id: (raw.assignee_id as number) ?? null,
    // v2 tasks encode done/milestone as 0/1
    done: Boolean(raw.done),
    milestone: Boolean(raw.milestone),
    due_date: (raw.due_date as string) ?? null,
    marked_as_done_time: (raw.marked_as_done_time as string) ?? null,
    update_time: (raw.update_time as string) ?? null,
  };
}

export function compactBoard(raw: Record<string, unknown>): CompactBoard {
  return {
    id: raw.id as number,
    name: (raw.name as string) ?? "",
    order_nr: (raw.order_nr as number) ?? null,
    update_time: (raw.update_time as string) ?? null,
  };
}

export function compactPhase(raw: Record<string, unknown>): CompactPhase {
  return {
    id: raw.id as number,
    name: (raw.name as string) ?? "",
    board_id: (raw.board_id as number) ?? null,
    order_nr: (raw.order_nr as number) ?? null,
    update_time: (raw.update_time as string) ?? null,
  };
}

export function compactProjectTemplate(raw: Record<string, unknown>): CompactProjectTemplate {
  return {
    id: raw.id as number,
    title: (raw.title as string) ?? "",
    description: (raw.description as string) ?? null,
    owner_id: (raw.owner_id as number) ?? null,
    update_time: (raw.update_time as string) ?? null,
  };
}

export function compactNote(raw: Record<string, unknown>): CompactNote {
  return {
    id: raw.id as number,
    content: (raw.content as string) ?? "",
    deal_id: (raw.deal_id as number) ?? null,
    person_id: (raw.person_id as number) ?? null,
    org_id: (raw.org_id as number) ?? null,
    lead_id: (raw.lead_id as string) ?? null,
    user_id: (raw.user_id as number) ?? null,
    pinned_to_deal_flag: (raw.pinned_to_deal_flag as boolean) ?? false,
    pinned_to_person_flag: (raw.pinned_to_person_flag as boolean) ?? false,
    pinned_to_organization_flag: (raw.pinned_to_organization_flag as boolean) ?? false,
    update_time: (raw.update_time as string) ?? null,
  };
}
