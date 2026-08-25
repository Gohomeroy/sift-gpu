export type VersionRow = {
  id: string;
  version_number: number;
  drive_file_id: string;
  note: string | null;
  link_verified_at: string | null;
  created_at: string;
};

export type CommentRow = {
  id: string;
  version_id: string;
  author_id: string;
  body: string;
  timestamp_seconds: number | null;
  resolved: boolean;
  created_at: string;
};
