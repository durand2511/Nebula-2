import { supabase } from "@/integrations/supabase/client";

export interface StorageFile {
  name: string;
  path: string;
  size: number;
  mimeType: string;
  createdAt: string;
  publicUrl: string;
}

function getUserFolder(userId: string): string {
  return userId;
}

export async function uploadFile(
  userId: string,
  file: File,
  projectId?: string
): Promise<StorageFile | null> {
  const folder = projectId
    ? `${getUserFolder(userId)}/${projectId}`
    : getUserFolder(userId);
  const filePath = `${folder}/${Date.now()}_${file.name}`;

  const { error } = await supabase.storage
    .from("user-files")
    .upload(filePath, file, { upsert: false });

  if (error) {
    console.error("Upload failed:", error);
    return null;
  }

  const { data: urlData } = supabase.storage
    .from("user-files")
    .getPublicUrl(filePath);

  return {
    name: file.name,
    path: filePath,
    size: file.size,
    mimeType: file.type,
    createdAt: new Date().toISOString(),
    publicUrl: urlData.publicUrl,
  };
}

export async function listFiles(
  userId: string,
  projectId?: string
): Promise<StorageFile[]> {
  const folder = projectId
    ? `${getUserFolder(userId)}/${projectId}`
    : getUserFolder(userId);

  const { data, error } = await supabase.storage
    .from("user-files")
    .list(folder, { sortBy: { column: "created_at", order: "desc" } });

  if (error || !data) {
    console.error("List files failed:", error);
    return [];
  }

  return data
    .filter((f) => f.name !== ".emptyFolderPlaceholder")
    .map((f) => {
      const fullPath = `${folder}/${f.name}`;
      const { data: urlData } = supabase.storage
        .from("user-files")
        .getPublicUrl(fullPath);

      return {
        name: f.name.replace(/^\d+_/, ""),
        path: fullPath,
        size: f.metadata?.size ?? 0,
        mimeType: f.metadata?.mimetype ?? "",
        createdAt: f.created_at ?? "",
        publicUrl: urlData.publicUrl,
      };
    });
}

export async function deleteFile(path: string): Promise<boolean> {
  const { error } = await supabase.storage
    .from("user-files")
    .remove([path]);

  if (error) {
    console.error("Delete failed:", error);
    return false;
  }
  return true;
}

export function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
