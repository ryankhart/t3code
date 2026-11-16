/** A thread's project as a sidebar filter choice, offered by the mounted sidebar. */
export interface SidebarProjectFilter {
  readonly describe: (thread: {
    readonly environmentId: string;
    readonly projectId: string;
  }) => { readonly label: string; readonly isActive: boolean } | null;
  readonly toggle: (thread: { readonly environmentId: string; readonly projectId: string }) => void;
}

let registeredFilter: SidebarProjectFilter | null = null;

export function registerSidebarProjectFilter(filter: SidebarProjectFilter): () => void {
  registeredFilter = filter;
  return () => {
    if (registeredFilter === filter) registeredFilter = null;
  };
}

/** Null when no sidebar is mounted, so there is no list to filter. */
export function readSidebarProjectFilter(): SidebarProjectFilter | null {
  return registeredFilter;
}
