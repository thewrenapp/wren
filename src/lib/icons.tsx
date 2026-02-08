import {
  IconFileTypePdf,
  IconNote,
  IconWorld,
  IconPaperclip,
  IconBook2,
  IconPhoto,
  IconMovie,
  IconFileCode,
  IconFileText,
  IconFile,
  IconArticle,
  IconBook,
  IconBookmark,
  IconPresentation,
  IconSchool,
  IconReport,
  IconNews,
  IconCode,
  IconDatabase,
  IconPalette,
  IconMicrophone2,
  IconVideo,
  IconHeadphones,
  IconBroadcast,
  IconDeviceTv,
  IconFileDescription,
  IconMail,
  IconWriting,
  IconCertificate,
  IconScale,
  IconReceipt,
  IconGavel,
  IconClipboard,
  IconMessageCircle,
  IconUsers,
  IconMap2,
  IconFiles,
  IconTrash,
  IconClock,
  IconTagOff,
  IconCopy,
  IconSearch,
  IconLibrary,
  IconHome,
  IconFolder,
} from '@tabler/icons-react';

// ---------------------------------------------------------------------------
// Attachment type icons (for file sub-rows, info panel, card indicators)
// ---------------------------------------------------------------------------

type IconEntry = {
  icon: React.ComponentType<{ className?: string; size?: number; stroke?: number }>;
  className: string;
};

const attachmentIconMap: Record<string, IconEntry> = {
  pdf: { icon: IconFileTypePdf, className: 'text-red-500' },
  note: { icon: IconNote, className: 'text-amber-500' },
  weblink: { icon: IconWorld, className: 'text-blue-500' },
  epub: { icon: IconBook2, className: 'text-emerald-500' },
  image: { icon: IconPhoto, className: 'text-violet-500' },
  video: { icon: IconMovie, className: 'text-pink-500' },
  snapshot: { icon: IconFileCode, className: 'text-cyan-500' },
  html: { icon: IconFileCode, className: 'text-cyan-500' },
  document: { icon: IconFileText, className: 'text-muted-foreground' },
};

const defaultAttachmentIcon: IconEntry = {
  icon: IconPaperclip,
  className: 'text-muted-foreground',
};

export function getAttachmentIcon(type: string): IconEntry {
  return attachmentIconMap[type] || defaultAttachmentIcon;
}

/** Drop-in AttachmentIcon component (replaces duplicated local versions) */
export function AttachmentIcon({
  type,
  className = 'h-4 w-4',
}: {
  type: string;
  className?: string;
}) {
  const { icon: Icon, className: colorClass } = getAttachmentIcon(type);
  return <Icon className={`${className} ${colorClass} flex-shrink-0`} />;
}

// ---------------------------------------------------------------------------
// Entry type icons (journal article, book, conference paper, legal, etc.)
// ---------------------------------------------------------------------------

const entryTypeIconMap: Record<
  string,
  React.ComponentType<{ className?: string; size?: number; stroke?: number }>
> = {
  // Academic
  journalArticle: IconArticle,
  book: IconBook,
  bookSection: IconBookmark,
  conferencePaper: IconPresentation,
  thesis: IconSchool,
  report: IconReport,
  preprint: IconFileText,

  // Web / Digital
  webpage: IconWorld,
  blogPost: IconWorld,
  forumPost: IconMessageCircle,

  // Periodicals
  magazineArticle: IconNews,
  newspaperArticle: IconNews,

  // Technical
  computerProgram: IconCode,
  dataset: IconDatabase,

  // Creative / Media
  artwork: IconPalette,
  film: IconMovie,
  podcast: IconMicrophone2,
  videoRecording: IconVideo,
  audioRecording: IconHeadphones,
  radioBroadcast: IconBroadcast,
  tvBroadcast: IconDeviceTv,

  // Documents
  document: IconFileDescription,
  note: IconNote,
  letter: IconMail,
  manuscript: IconWriting,
  patent: IconCertificate,

  // Legal
  statute: IconScale,
  bill: IconReceipt,
  case: IconGavel,
  hearing: IconClipboard,

  // Reference
  encyclopediaArticle: IconBook,
  dictionaryEntry: IconBook,
  interview: IconUsers,
  presentation: IconPresentation,
  map: IconMap2,
};

export function getEntryTypeIcon(
  itemType: string,
): React.ComponentType<{ className?: string; size?: number; stroke?: number }> {
  return entryTypeIconMap[itemType] || IconFile;
}

// ---------------------------------------------------------------------------
// Entry type display names (moved from EntryCardView.tsx)
// ---------------------------------------------------------------------------

export const entryTypeDisplayNames: Record<string, string> = {
  journalArticle: 'Journal Article',
  book: 'Book',
  bookSection: 'Book Section',
  conferencePaper: 'Conference Paper',
  thesis: 'Thesis',
  report: 'Report',
  preprint: 'Preprint',
  webpage: 'Web Page',
  blogPost: 'Blog Post',
  forumPost: 'Forum Post',
  magazineArticle: 'Magazine Article',
  newspaperArticle: 'Newspaper Article',
  computerProgram: 'Software',
  document: 'Document',
  dataset: 'Dataset',
  patent: 'Patent',
  artwork: 'Artwork',
  film: 'Film',
  podcast: 'Podcast',
  videoRecording: 'Video Recording',
  audioRecording: 'Audio Recording',
  radioBroadcast: 'Radio Broadcast',
  tvBroadcast: 'TV Broadcast',
  note: 'Note',
  letter: 'Letter',
  manuscript: 'Manuscript',
  statute: 'Statute',
  bill: 'Bill',
  case: 'Case',
  hearing: 'Hearing',
  encyclopediaArticle: 'Encyclopedia Article',
  dictionaryEntry: 'Dictionary Entry',
  interview: 'Interview',
  presentation: 'Presentation',
  map: 'Map',
};

// ---------------------------------------------------------------------------
// Sidebar icons
// ---------------------------------------------------------------------------

export const sidebarIcons = {
  allItems: IconFiles,
  pdfs: IconFileTypePdf,
  notes: IconNote,
  trash: IconTrash,
  recent: IconClock,
  untagged: IconTagOff,
  duplicates: IconCopy,
  search: IconSearch,
};

// ---------------------------------------------------------------------------
// Tab icons
// ---------------------------------------------------------------------------

export const tabIconMap = {
  library: IconLibrary,
  item: IconFileText,
  entry: IconArticle,
  markdown: IconFileText,
  search: IconSearch,
  collection: IconFolder,
  welcome: IconHome,
};
