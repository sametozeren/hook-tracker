import { ref } from 'vue';

export function useFieldErrors(fields) {
  const fieldErrors = ref({});

  function applyFieldErrors(error) {
    const reported = error.fieldErrors();
    const known = Object.entries(reported).filter(([field]) => fields.includes(field));

    fieldErrors.value = Object.fromEntries(known);

    return known.length > 0;
  }

  return { fieldErrors, applyFieldErrors };
}
