import { supabase } from "@/integrations/supabase/client";
import type { ChatMessage } from "@/lib/aiStream";

export type DomainStatus = "none" | "pending" | "connected";

export interface AppProject {
  id: string;
  userId: string;
  name: string;
  description: string;
  html: string;
  domain: string;
  domainStatus: DomainStatus;
  publishedUrl: string | null;
  visibility: "public" | "private";
  chatHistory: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

function rowToProject(row: any): AppProject {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description || "",
    html: row.html || "",
    domain: row.domain || "",
    domainStatus: (row.domain_status || "none") as DomainStatus,
    publishedUrl: row.published_url,
    visibility: (row.visibility || "public") as "public" | "private",
    chatHistory: (row.chat_history as ChatMessage[]) || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getProjects(): Promise<AppProject[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch projects:", error);
    return [];
  }
  return (data || []).map(rowToProject);
}

export async function getProject(id: string): Promise<AppProject | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  return rowToProject(data);
}

export async function createProject(name: string, html: string, userId: string): Promise<AppProject | null> {
  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: userId,
      name,
      html,
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to create project:", error);
    return null;
  }
  return rowToProject(data);
}

export async function updateProject(
  id: string,
  updates: Partial<Omit<AppProject, "id" | "createdAt" | "userId">>
): Promise<AppProject | null> {
  const dbUpdates: Record<string, any> = { updated_at: new Date().toISOString() };
  if (updates.name !== undefined) dbUpdates.name = updates.name;
  if (updates.description !== undefined) dbUpdates.description = updates.description;
  if (updates.html !== undefined) dbUpdates.html = updates.html;
  if (updates.domain !== undefined) dbUpdates.domain = updates.domain;
  if (updates.domainStatus !== undefined) dbUpdates.domain_status = updates.domainStatus;
  if (updates.publishedUrl !== undefined) dbUpdates.published_url = updates.publishedUrl;
  if (updates.visibility !== undefined) dbUpdates.visibility = updates.visibility;
  if (updates.chatHistory !== undefined) dbUpdates.chat_history = updates.chatHistory;

  const { data, error } = await supabase
    .from("projects")
    .update(dbUpdates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Failed to update project:", error);
    return null;
  }
  return rowToProject(data);
}

export async function deleteProject(id: string): Promise<boolean> {
  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Failed to delete project:", error);
    return false;
  }
  return true;
}
