import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

export function useQueryFilters(keys, { dropUnlisted = false } = {}) {
  const route = useRoute();
  const router = useRouter();

  const dropped = ref([]);

  const filters = computed(() => {
    const picked = {};

    for (const key of keys) {
      const value = route.query[key];

      if (typeof value === 'string' && value !== '') {
        picked[key] = value;
      }
    }

    return picked;
  });

  const filterKey = computed(() => keys.map((key) => filters.value[key] ?? '').join('|'));

  const hasFilters = computed(() => Object.keys(filters.value).length > 0);

  // The nested delivery-detail route is /deliveries/:deliveryId, so the target
  // must name the route and carry its params; a bare { query } would resolve
  // against the current path and can drop them. The query object is passed on
  // with its keys in their existing order, because closeDetail and the row links
  // carry route.query verbatim and would otherwise change shape.
  function write(query) {
    router.replace({ name: route.name, params: route.params, query });
  }

  function update(patch) {
    const query = { ...route.query };

    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === null || value === '') {
        delete query[key];
      } else {
        query[key] = value;
      }
    }

    if (dropUnlisted) {
      for (const key of Object.keys(query)) {
        if (!keys.includes(key)) {
          delete query[key];
        }
      }
    }

    write(query);
  }

  function clear() {
    update(Object.fromEntries(keys.map((key) => [key, undefined])));
  }

  // A screen that honours a narrower key set shares the URL with screens that
  // honour a wider one. A filter this screen does not apply must not survive in
  // the URL, or it reads as active on the screen that does apply it while the
  // rows here were paged under a narrower set.
  onMounted(() => {
    if (!dropUnlisted) {
      return;
    }

    const present = Object.keys(route.query).filter((key) => !keys.includes(key));

    if (present.length === 0) {
      return;
    }

    dropped.value = present;
    update({});
  });

  return { filters, filterKey, hasFilters, update, clear, dropped };
}
