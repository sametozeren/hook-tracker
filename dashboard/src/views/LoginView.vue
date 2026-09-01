<script setup>
import { onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';
import { useFieldErrors } from '../lib/field-errors.js';
import { ApiError } from '../lib/problem.js';
import AuthFormError from '../components/AuthFormError.vue';
import AuthLayout from '../components/AuthLayout.vue';
import PasswordField from '../components/PasswordField.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import UiButton from '../components/ui/UiButton.vue';

const FIELDS = ['email', 'password'];
const MAX_EMAIL_LENGTH = 254;

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const { fieldErrors, applyFieldErrors } = useFieldErrors(FIELDS);

const email = ref('');
const password = ref('');
const passwordVisible = ref(false);
const submitting = ref(false);
const formError = ref(null);
const projectless = ref(false);
const emailInput = ref(null);

onMounted(() => {
  emailInput.value?.focus();
});

function validate() {
  const errors = {};
  const trimmedEmail = email.value.trim();

  if (!trimmedEmail) {
    errors.email = 'Enter the email you signed up with.';
  } else if (trimmedEmail.length > MAX_EMAIL_LENGTH) {
    errors.email = `An email address is at most ${MAX_EMAIL_LENGTH} characters.`;
  }

  if (!password.value) {
    errors.password = 'Enter your password.';
  }

  fieldErrors.value = errors;

  return Object.keys(errors).length === 0;
}

function reportFailure(error) {
  if (!(error instanceof ApiError)) {
    formError.value = {
      message: 'The dashboard could not reach the API.',
      detail: error.message,
    };

    return;
  }

  // The API answers a wrong email and a wrong password identically, and
  // docs/dashboard.md requires the screen to keep it that way.
  if (error.status === 401) {
    formError.value = { message: 'Those credentials do not match an account.' };

    return;
  }

  if (error.status === 429) {
    formError.value = { message: 'Too many attempts. Wait a minute and try again.' };

    return;
  }

  if (error.kind === 'validation-failed' && applyFieldErrors(error)) {
    return;
  }

  formError.value = {
    message: error.title || 'The sign in did not go through.',
    detail: error.detail,
    requestId: error.requestId,
  };
}

function landAfterLogin() {
  const { redirect } = route.query;

  // A protocol-relative path ("//host") also starts with a slash but leaves the
  // dashboard, so it is rejected along with the absolute URLs.
  if (typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')) {
    router.push(redirect);

    return;
  }

  const project = auth.projects[0];

  if (!project) {
    projectless.value = true;

    return;
  }

  router.push({ name: 'deliveries', params: { projectId: project.id } });
}

async function submit() {
  if (submitting.value) {
    return;
  }

  formError.value = null;

  if (!validate()) {
    return;
  }

  submitting.value = true;

  try {
    await auth.login({ email: email.value.trim(), password: password.value });
    landAfterLogin();
  } catch (error) {
    reportFailure(error);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthLayout title="Sign in" subtitle="Watch every webhook this instance delivers.">
    <EmptyState
      v-if="projectless"
      title="You are signed in, but no project is yours yet."
      description="An owner has to add this email to a project before there is anything to watch. Sign in again once they have."
    />

    <form v-else novalidate class="space-y-5" @submit.prevent="submit">
      <AuthFormError
        v-if="formError"
        :message="formError.message"
        :detail="formError.detail || ''"
        :request-id="formError.requestId || ''"
      />

      <div>
        <label for="login-email" class="block text-sm font-medium text-ink">Email</label>
        <input
          id="login-email"
          ref="emailInput"
          v-model="email"
          type="email"
          name="email"
          autocomplete="email"
          inputmode="email"
          spellcheck="false"
          autocapitalize="none"
          required
          :maxlength="MAX_EMAIL_LENGTH"
          :aria-invalid="fieldErrors.email ? 'true' : undefined"
          :aria-describedby="fieldErrors.email ? 'login-email-error' : undefined"
          class="mt-1.5 w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint"
          :class="fieldErrors.email ? 'border-fail' : 'border-rule'"
        />
        <p v-if="fieldErrors.email" id="login-email-error" class="mt-1.5 text-xs text-fail">
          {{ fieldErrors.email }}
        </p>
      </div>

      <PasswordField
        id="login-password"
        v-model="password"
        v-model:visible="passwordVisible"
        autocomplete="current-password"
        :error="fieldErrors.password || ''"
      />

      <UiButton
        type="submit"
        variant="primary"
        class="w-full"
        :loading="submitting"
        :disabled="submitting"
      >
        {{ submitting ? 'Signing in' : 'Sign in' }}
      </UiButton>
    </form>

    <template #footer>
      <p>
        No account yet?
        <RouterLink
          to="/register"
          class="text-ink underline decoration-rule underline-offset-4 hover:decoration-ink"
        >
          Create an account
        </RouterLink>
      </p>
    </template>
  </AuthLayout>
</template>
