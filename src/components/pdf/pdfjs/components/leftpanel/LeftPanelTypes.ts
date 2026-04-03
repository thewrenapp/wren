import React from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { DocumentOutlineStyles, DocumentOutlineClassNames } from './DocumentOutline';
import type { OutlineItemRenderProps, OutlineItemStyles, OutlineItemClassNames } from './OutlineItem';
import type { LeftPanelTab, ProcessedOutlineItem, ThumbnailData } from '../../types';

/** Theme configuration for LeftPanel styling */
export interface LeftPanelTheme {
  /** Background color of the panel */
  backgroundColor?: string;
  /** Border color */
  borderColor?: string;
  /** Active tab/item accent color */
  accentColor?: string;
  /** Text color */
  textColor?: string;
  /** Muted text color */
  mutedTextColor?: string;
  /** Hover background color */
  hoverBackgroundColor?: string;
}

/** Style configuration for tab buttons */
export interface TabStyles {
  /** Container styles for the tab bar */
  container?: React.CSSProperties;
  /** Tab button styles */
  tab?: React.CSSProperties;
  /** Tab button styles when active */
  tabActive?: React.CSSProperties;
  /** Tab icon styles */
  tabIcon?: React.CSSProperties;
  /** Tab text styles */
  tabText?: React.CSSProperties;
}

/** Class name configuration for tab buttons (Tailwind-friendly) */
export interface TabClassNames {
  /** Container class for the tab bar */
  container?: string;
  /** Tab button class */
  tab?: string;
  /** Tab button class when active */
  tabActive?: string;
  /** Tab icon class */
  tabIcon?: string;
  /** Tab text class */
  tabText?: string;
}

/** Style configuration for the footer */
export interface FooterStyles {
  /** Footer container styles */
  container?: React.CSSProperties;
  /** Footer text styles */
  text?: React.CSSProperties;
}

/** Class name configuration for the footer (Tailwind-friendly) */
export interface FooterClassNames {
  /** Footer container class */
  container?: string;
  /** Footer text class */
  text?: string;
}

/** Style configuration for the toggle button */
export interface ToggleButtonStyles {
  /** Button container styles */
  button?: React.CSSProperties;
  /** Button icon styles */
  icon?: React.CSSProperties;
}

/** Class name configuration for the toggle button (Tailwind-friendly) */
export interface ToggleButtonClassNames {
  /** Button container class */
  button?: string;
  /** Button icon class */
  icon?: string;
}

export const defaultTheme: LeftPanelTheme = {
  backgroundColor: 'hsl(var(--background))',
  borderColor: 'hsl(var(--border))',
  accentColor: 'hsl(var(--primary))',
  textColor: 'hsl(var(--foreground))',
  mutedTextColor: 'hsl(var(--muted-foreground))',
  hoverBackgroundColor: 'hsl(var(--accent))',
};

export interface PDFViewerInterface {
  scrollPageIntoView: (params: { pageNumber: number }) => void;
  pagesCount: number;
  currentPageNumber?: number;
}

export interface PDFLinkServiceInterface {
  goToDestination: (dest: unknown) => void;
}

export interface EventBusInterface {
  on: (event: string, callback: (evt: { pageNumber: number }) => void) => void;
  off: (event: string, callback: (evt: { pageNumber: number }) => void) => void;
}

export interface LeftPanelProps {
  /** PDF document from PdfLoader */
  pdfDocument: PDFDocumentProxy;
  /** PDF viewer instance */
  viewer?: PDFViewerInterface | unknown | null;
  /** PDF link service for navigation */
  linkService?: PDFLinkServiceInterface | unknown | null;
  /** Event bus for page change events */
  eventBus?: EventBusInterface | unknown | null;
  /** Function to navigate to a page (from pdfHighlighterUtils.goToPage) */
  goToPage?: (pageNumber: number) => void;
  /** Whether panel is open */
  isOpen?: boolean;
  /** Callback when open state changes */
  onOpenChange?: (isOpen: boolean) => void;
  /** Initial active tab */
  defaultTab?: LeftPanelTab;
  /** Which tabs to show */
  tabs?: LeftPanelTab[];
  /** Panel width when open */
  width?: number | string;
  /** Custom class name */
  className?: string;
  /** Custom styles */
  style?: React.CSSProperties;
  /** Custom outline item renderer */
  renderOutlineItem?: (
    item: ProcessedOutlineItem,
    props: OutlineItemRenderProps
  ) => React.ReactNode;
  /** Custom thumbnail renderer */
  renderThumbnail?: (
    pageNumber: number,
    thumbnail: ThumbnailData,
    isActive: boolean
  ) => React.ReactNode;
  /** Callback when page is selected */
  onPageSelect?: (pageNumber: number) => void;
  /** Thumbnail width */
  thumbnailWidth?: number;
  /** Children for custom content */
  children?: React.ReactNode;
  /** Theme customization */
  theme?: LeftPanelTheme;
  /** Show page count in footer */
  showFooter?: boolean;
  /** Show toggle button */
  showToggleButton?: boolean;
  /** Custom styles for tabs */
  tabStyles?: TabStyles;
  /** Custom class names for tabs (Tailwind-friendly) */
  tabClassNames?: TabClassNames;
  /** Custom styles for footer */
  footerStyles?: FooterStyles;
  /** Custom class names for footer (Tailwind-friendly) */
  footerClassNames?: FooterClassNames;
  /** Custom styles for toggle button */
  toggleButtonStyles?: ToggleButtonStyles;
  /** Custom class names for toggle button (Tailwind-friendly) */
  toggleButtonClassNames?: ToggleButtonClassNames;
  /** Custom styles for document outline */
  outlineStyles?: DocumentOutlineStyles;
  /** Custom class names for document outline (Tailwind-friendly) */
  outlineClassNames?: DocumentOutlineClassNames;
  /** Custom styles for outline items */
  outlineItemStyles?: OutlineItemStyles;
  /** Custom class names for outline items (Tailwind-friendly) */
  outlineItemClassNames?: OutlineItemClassNames;
}
