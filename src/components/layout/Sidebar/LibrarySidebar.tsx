import { useState, useEffect, type MutableRefObject } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useDragDropContext } from '@/components/dnd/DragDropProvider';
import { FilterSection } from './FilterSection';
import { SavedSearchesSection } from './SavedSearchesSection';
import { CollectionsSection } from './CollectionsSection';
import { TagsSection } from './TagsSection';

interface LibrarySidebarProps {
  expandCollectionsRef?: MutableRefObject<(() => void) | null>;
}

export function LibrarySidebar({ expandCollectionsRef }: LibrarySidebarProps) {
  const { isDragging } = useDragDropContext();

  const [collectionsOpen, setCollectionsOpen] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(false);

  useEffect(() => {
    if (expandCollectionsRef) {
      expandCollectionsRef.current = () => setCollectionsOpen(true);
    }
    return () => {
      if (expandCollectionsRef) {
        expandCollectionsRef.current = null;
      }
    };
  }, [expandCollectionsRef]);

  useEffect(() => {
    if (isDragging) {
      setCollectionsOpen(true);
      setTagsOpen(true);
    }
  }, [isDragging]);

  return (
    <div className='flex flex-col h-full w-full overflow-hidden'>
      <ScrollArea className='flex-1 px-2 pt-2 w-full min-w-0'>
        <FilterSection />
        <SavedSearchesSection />
        <CollectionsSection
          collectionsOpen={collectionsOpen}
          onCollectionsOpenChange={setCollectionsOpen}
        />
        <TagsSection
          tagsOpen={tagsOpen}
          onTagsOpenChange={setTagsOpen}
        />
      </ScrollArea>
    </div>
  );
}
