import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { List, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { LeftPanelContext, LeftPanelUtils } from '../../contexts/LeftPanelContext';
import { useDocumentOutline } from '../../hooks/useDocumentOutline';
import { useThumbnails } from '../../hooks/useThumbnails';
import { usePageNavigation } from '../../hooks/usePageNavigation';
import { DocumentOutline } from './DocumentOutline';
import { ThumbnailPanel } from './ThumbnailPanel';
import type { LeftPanelTab, ProcessedOutlineItem } from '../../types';
import { defaultTheme } from './LeftPanelTypes';
import type { LeftPanelProps } from './LeftPanelTypes';

export type {
  LeftPanelTheme,
  TabStyles,
  TabClassNames,
  FooterStyles,
  FooterClassNames,
  ToggleButtonStyles,
  ToggleButtonClassNames,
} from './LeftPanelTypes';
export type { LeftPanelProps };

/**
 * Left panel component with Outline and Thumbnails tabs.
 * Provides a customizable sidebar for PDF navigation with page thumbnails and document outline.
 */
export const LeftPanel: React.FC<LeftPanelProps> = ({
  pdfDocument,
  viewer = null,
  linkService: _linkService = null,
  eventBus = null,
  goToPage: goToPageProp,
  isOpen: controlledIsOpen,
  onOpenChange,
  defaultTab = 'thumbnails',
  tabs = ['outline', 'thumbnails'],
  width = 260,
  className = '',
  style,
  renderOutlineItem,
  renderThumbnail,
  onPageSelect,
  thumbnailWidth = 180,
  children,
  theme: userTheme,
  showFooter = true,
  showToggleButton = true,
  tabStyles,
  tabClassNames,
  footerStyles,
  footerClassNames,
  toggleButtonStyles,
  toggleButtonClassNames,
  outlineStyles,
  outlineClassNames,
  outlineItemStyles,
  outlineItemClassNames,
}) => {
  const theme = useMemo(() => ({ ...defaultTheme, ...userTheme }), [userTheme]);
  const [internalIsOpen, setInternalIsOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<LeftPanelTab>(defaultTab);

  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;
  const setIsOpen = useCallback(
    (open: boolean) => {
      if (onOpenChange) {
        onOpenChange(open);
      } else {
        setInternalIsOpen(open);
      }
    },
    [onOpenChange]
  );

  const { thumbnails, loadThumbnail, totalPages } = useThumbnails({ pdfDocument, thumbnailWidth });
  const { currentPage, goToPage: goToPageFromHook } = usePageNavigation({ viewer, eventBus });
  const goToPagePropRef = useRef(goToPageProp);

  useEffect(() => {
    goToPagePropRef.current = goToPageProp;
  }, [goToPageProp]);

  const handlePageSelect = useCallback(
    (pageNumber: number) => {
      if (goToPagePropRef.current) {
        goToPagePropRef.current(pageNumber);
      } else {
        goToPageFromHook(pageNumber);
      }
      onPageSelect?.(pageNumber);
    },
    [goToPageFromHook, onPageSelect]
  );

  const { outline, isLoading: isOutlineLoading, hasOutline, navigateToItem } = useDocumentOutline({
    pdfDocument,
    goToPage: handlePageSelect,
  });

  const handleOutlineNavigate = useCallback(
    (item: ProcessedOutlineItem) => {
      navigateToItem(item);
      onPageSelect?.(item.pageNumber);
    },
    [navigateToItem, onPageSelect]
  );

  const contextValue: LeftPanelUtils = useMemo(
    () => ({
      currentPage, totalPages, goToPage: handlePageSelect, goToOutlineItem: handleOutlineNavigate,
      pdfDocument, outline, hasOutline, isOutlineLoading, thumbnails, loadThumbnail,
      activeTab, setActiveTab, isOpen, setIsOpen,
    }),
    [currentPage, totalPages, handlePageSelect, handleOutlineNavigate, pdfDocument, outline,
     hasOutline, isOutlineLoading, thumbnails, loadThumbnail, activeTab, isOpen, setIsOpen]
  );

  const panelWidth = typeof width === 'number' ? `${width}px` : width;

  const cssVars = {
    '--lp-bg': theme.backgroundColor, '--lp-border': theme.borderColor,
    '--lp-accent': theme.accentColor, '--lp-text': theme.textColor,
    '--lp-muted': theme.mutedTextColor, '--lp-hover': theme.hoverBackgroundColor,
  } as React.CSSProperties;

  const renderTabButton = (tab: LeftPanelTab, label: string, Icon: typeof FileText) => (
    <button
      className={[tabClassNames?.tab, activeTab === tab ? tabClassNames?.tabActive : ''].filter(Boolean).join(' ') || undefined}
      onClick={() => setActiveTab(tab)}
      style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
        padding: '12px 16px', fontSize: '13px', fontWeight: 500,
        color: activeTab === tab ? theme.accentColor : theme.mutedTextColor,
        backgroundColor: activeTab === tab ? `${theme.accentColor}08` : 'transparent',
        borderBottom: activeTab === tab ? `2px solid ${theme.accentColor}` : '2px solid transparent',
        border: 'none', cursor: 'pointer', transition: 'all 0.15s ease',
        ...tabStyles?.tab, ...(activeTab === tab ? tabStyles?.tabActive : {}),
      }}
    >
      <Icon className={tabClassNames?.tabIcon} style={{ width: 15, height: 15, ...tabStyles?.tabIcon }} />
      <span className={tabClassNames?.tabText} style={tabStyles?.tabText}>{label}</span>
    </button>
  );

  return (
    <LeftPanelContext.Provider value={contextValue}>
      {showToggleButton && (
        <button
          className={toggleButtonClassNames?.button}
          onClick={() => setIsOpen(!isOpen)}
          style={{
            position: 'absolute', top: '50%', transform: 'translateY(-50%)',
            left: isOpen ? `calc(${panelWidth} - 1px)` : '0', zIndex: 20,
            width: '24px', height: '48px', backgroundColor: theme.backgroundColor,
            border: `1px solid ${theme.borderColor}`, borderLeft: 'none',
            borderRadius: '0 6px 6px 0', display: 'flex', alignItems: 'center',
            justifyContent: 'center', cursor: 'pointer',
            boxShadow: '2px 0 8px rgba(0,0,0,0.08)',
            transition: 'left 0.2s ease-in-out, background-color 0.15s ease',
            ...toggleButtonStyles?.button,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = theme.hoverBackgroundColor || 'hsl(var(--accent))';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = theme.backgroundColor || 'hsl(var(--background))';
          }}
          aria-label={isOpen ? 'Close panel' : 'Open panel'}
        >
          {isOpen ? (
            <ChevronLeft className={toggleButtonClassNames?.icon} style={{ width: 14, height: 14, color: theme.mutedTextColor, ...toggleButtonStyles?.icon }} />
          ) : (
            <ChevronRight className={toggleButtonClassNames?.icon} style={{ width: 14, height: 14, color: theme.mutedTextColor, ...toggleButtonStyles?.icon }} />
          )}
        </button>
      )}

      <div
        className={`left-panel ${className}`}
        style={{
          display: 'flex', flexDirection: 'column', height: '100%',
          backgroundColor: theme.backgroundColor, borderRight: `1px solid ${theme.borderColor}`,
          transition: 'width 0.2s ease-in-out, min-width 0.2s ease-in-out',
          position: 'relative', width: isOpen ? panelWidth : '0px',
          minWidth: isOpen ? panelWidth : '0px', overflow: 'hidden', ...cssVars, ...style,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', width: panelWidth, minWidth: panelWidth }}>
          {tabs.length > 1 && (
            <div className={tabClassNames?.container} style={{ display: 'flex', borderBottom: `1px solid ${theme.borderColor}`, flexShrink: 0, ...tabStyles?.container }}>
              {tabs.includes('outline') && renderTabButton('outline', 'Outline', FileText)}
              {tabs.includes('thumbnails') && renderTabButton('thumbnails', 'Pages', List)}
            </div>
          )}

          {tabs.length === 1 && (
            <div className={tabClassNames?.container} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', borderBottom: `1px solid ${theme.borderColor}`, flexShrink: 0, ...tabStyles?.container }}>
              {tabs[0] === 'outline' ? (
                <>
                  <FileText className={tabClassNames?.tabIcon} style={{ width: 15, height: 15, color: theme.mutedTextColor, ...tabStyles?.tabIcon }} />
                  <span className={tabClassNames?.tabText} style={{ fontSize: '13px', fontWeight: 500, color: theme.textColor, ...tabStyles?.tabText }}>Outline</span>
                </>
              ) : (
                <>
                  <List className={tabClassNames?.tabIcon} style={{ width: 15, height: 15, color: theme.mutedTextColor, ...tabStyles?.tabIcon }} />
                  <span className={tabClassNames?.tabText} style={{ fontSize: '13px', fontWeight: 500, color: theme.textColor, ...tabStyles?.tabText }}>Pages</span>
                </>
              )}
            </div>
          )}

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
            {activeTab === 'outline' && tabs.includes('outline') && (
              <DocumentOutline
                outline={outline} isLoading={isOutlineLoading} currentPage={currentPage}
                onNavigate={handleOutlineNavigate} renderItem={renderOutlineItem}
                styles={outlineStyles} classNames={outlineClassNames}
                itemStyles={outlineItemStyles} itemClassNames={outlineItemClassNames}
              />
            )}
            {activeTab === 'thumbnails' && tabs.includes('thumbnails') && (
              <ThumbnailPanel
                totalPages={totalPages} currentPage={currentPage} thumbnails={thumbnails}
                loadThumbnail={loadThumbnail} onPageSelect={handlePageSelect} renderThumbnail={renderThumbnail}
              />
            )}
            {children}
          </div>

          {showFooter && (
            <div className={footerClassNames?.container} style={{ flexShrink: 0, borderTop: `1px solid ${theme.borderColor}`, padding: '10px 16px', backgroundColor: theme.hoverBackgroundColor, ...footerStyles?.container }}>
              <div className={footerClassNames?.text} style={{ fontSize: '12px', color: theme.mutedTextColor, textAlign: 'center', fontWeight: 500, ...footerStyles?.text }}>
                Page {currentPage} of {totalPages}
              </div>
            </div>
          )}
        </div>
      </div>
    </LeftPanelContext.Provider>
  );
};
