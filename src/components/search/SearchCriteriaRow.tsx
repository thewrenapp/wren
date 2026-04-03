import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { advancedFields, advancedOperators, type AdvancedCriterion } from "./searchFieldConfig";

type Collection = {
  id: number;
  name: string;
};

type SavedSearch = {
  id: number;
  name: string;
};

interface SearchCriteriaRowProps {
  criterion: AdvancedCriterion;
  collections: Collection[];
  savedSearches: SavedSearch[];
  onUpdate: (id: string, updates: Partial<AdvancedCriterion>) => void;
  onRemove: (id: string) => void;
}

export function SearchCriteriaRow({
  criterion,
  collections,
  savedSearches,
  onUpdate,
  onRemove,
}: SearchCriteriaRowProps) {
  const operator = advancedOperators.find((op) => op.value === criterion.operator);
  const requiresValue = operator ? operator.requiresValue : true;
  const isCollection = criterion.field === "collection";
  const isSavedSearch = criterion.field === "saved_search";
  const isDropdownField = isCollection || isSavedSearch;

  return (
    <div className="flex items-center gap-2">
      <Select
        value={criterion.field}
        onValueChange={(value) => onUpdate(criterion.id, { field: value })}
      >
        <SelectTrigger className="h-8 w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {advancedFields.map((field) => (
            <SelectItem key={field.value} value={field.value}>
              {field.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={criterion.operator}
        onValueChange={(value) => onUpdate(criterion.id, { operator: value })}
      >
        <SelectTrigger className="h-8 w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {advancedOperators
            .filter((op) => (isDropdownField ? ["is", "is_not"].includes(op.value) : true))
            .map((op) => (
              <SelectItem key={op.value} value={op.value}>
                {op.label}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      {isCollection ? (
        <Select
          value={criterion.value}
          onValueChange={(value) => onUpdate(criterion.id, { value })}
        >
          <SelectTrigger className="h-8 flex-1">
            <SelectValue placeholder="Select collection" />
          </SelectTrigger>
          <SelectContent>
            {collections.map((collection) => (
              <SelectItem key={collection.id} value={collection.id.toString()}>
                {collection.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : isSavedSearch ? (
        <Select
          value={criterion.value}
          onValueChange={(value) => onUpdate(criterion.id, { value })}
        >
          <SelectTrigger className="h-8 flex-1">
            <SelectValue placeholder="Select smart filter" />
          </SelectTrigger>
          <SelectContent>
            {savedSearches.map((search) => (
              <SelectItem key={search.id} value={search.id.toString()}>
                {search.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          value={criterion.value}
          onChange={(event) =>
            onUpdate(criterion.id, { value: event.target.value })
          }
          placeholder={requiresValue ? "Value" : "No value needed"}
          disabled={!requiresValue}
          className="h-8 flex-1"
        />
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onRemove(criterion.id)}
        className="h-8 w-8 shrink-0"
        aria-label="Remove rule"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
