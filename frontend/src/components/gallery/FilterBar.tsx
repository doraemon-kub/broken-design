// Gallery filters — connected to URL searchParams (?tag=&license=&price=).
import { GALLERY_TAGS, LICENSES, type ModelsParams } from '@/lib/types';
import FilterDropdown from './FilterDropdown';

export default function FilterBar({ params = {} }: { params?: ModelsParams }) {
  return (
    <div className="ml-auto flex flex-wrap items-center justify-end gap-3" role="group" aria-label="Filters">
      <FilterDropdown label="Tag" paramKey="tag" options={['All', ...GALLERY_TAGS]} params={params} />
      <FilterDropdown label="License" paramKey="license" options={['All', ...LICENSES]} params={params} />
      <FilterDropdown label="Price" paramKey="price" options={['All', 'Free', 'Paid']} params={params} />
    </div>
  );
}
