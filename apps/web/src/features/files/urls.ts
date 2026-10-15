export const fileUrl = (id: string) => `/api/files/${encodeURIComponent(id)}`;
export const previewUrl = (id: string) => `/api/files/${encodeURIComponent(id)}/preview`;
