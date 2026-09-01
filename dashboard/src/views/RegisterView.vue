<script setup>
import { onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';
import { useFieldErrors } from '../lib/field-errors.js';
import { ApiError } from '../lib/problem.js';
import AuthFormError from '../components/AuthFormError.vue';
import AuthLayout from '../components/AuthLayout.vue';
import PasswordField from '../components/PasswordField.vue';
import UiButton from '../components/ui/UiButton.vue';

const FIELDS = ['name', 'email', 'password', 'projectName'];
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 200;
const MAX_NAME_LENGTH = 120;

const router = useRouter();
const auth = useAuthStore();

const { fieldErrors, applyFieldErrors } = useFieldErrors(FIELDS);

const name = ref('');
const email = ref('');
const password = ref('');
const projectName = ref('');
const passwordVisible = ref(false);
const submitting = ref(false);
const formError = ref(null);
const nameInput = ref(null);

onMounted(() => {
  nameInput.value?.focus();
});

function validate() {
  const errors = {};
  const trimmedName = name.value.trim();
  const trimmedEmail = email.value.trim();
  const trimmedProjectName = projectName.value.trim();

  if (!trimmedName) {
    errors.name = 'Enter the name your teammates will see.';
  } else if (trimmedName.length > MAX_NAME_LENGTH) {
    errors.name = `A name is at most ${MAX_NAME_LENGTH} characters.`;
  }

  if (!trimmedEmail) {
    errors.email = 'Enter the email you will sign in with.';
  } else if (trimmedEmail.length > MAX_EMAIL_LENGTH) {
    errors.email = `An email address is at most ${MAX_EMAIL_LENGTH} characters.`;
  }

  if (password.value.length < MIN_PASSWORD_LENGTH) {
    errors.password = `A password is at least ${MIN_PASSWORD_LENGTH} characters.`;
  } else if (password.value.length > MAX_PASSWORD_LENGTH) {
    errors.password = `A password is at most ${MAX_PASSWORD_LENGTH} characters.`;
  }

  if (!trimmedProjectName) {
    errors.projectName = 'Name the project this account will own.';
  } else if (trimmedProjectName.length > MAX_NAME_LENGTH) {
    errors.projectName = `A project name is at most ${MAX_NAME_LENGTH} characters.`;
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

  if (error.status === 409) {
    formError.value = {
      message: 'An account with this email already exists.',
      offerSignIn: true,
    };

    return;
  }

  if (error.status === 429) {
    formError.value = { message: 'Too many attempts. Wait a minute and try again.' };

    return;
  }

  if (error.kind === 'validation-failed' && applyFieldErrors(error)) {
    return;
  }

  // The API exposes no way to ask in advance whether registration is open, so
  // whatever refusal it sends is reported here verbatim instead of guessed at.
  formError.value = {
    message: error.title || 'The account was not created.',
    detail: error.detail,
    requestId: error.requestId,
  };
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
    const session = await auth.register({
      name: name.value.trim(),
      email: email.value.trim(),
      password: password.value,
      projectName: projectName.value.trim(),
    });

    router.push({ name: 'deliveries', params: { projectId: session.project.id } });
  } catch (error) {
    reportFailure(error);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthLayout title="Create an account" subtitle="It owns a new project and becomes its owner.">
    <form novalidate class="space-y-5" @submit.prevent="submit">
      <AuthFormError
        v-if="formError"
        :message="formError.message"
        :detail="formError.detail || ''"
        :request-id="formError.requestId || ''"
      >
        <p v-if="formError.offerSignIn" class="mt-1 text-sm text-ink">
          <RouterLink
            to="/login"
            class="text-ink underline decoration-rule underline-offset-4 hover:decoration-ink"
          >
            Sign in instead
          </RouterLink>
        </p>
      </AuthFormError>

      <div>
        <label for="register-name" class="block text-sm font-medium text-ink">Your name</label>
        <input
          id="register-name"
          ref="nameInput"
          v-model="name"
          type="text"
          name="name"
          autocomplete="name"
          required
          :maxlength="MAX_NAME_LENGTH"
          :aria-invalid="fieldErrors.name ? 'true' : undefined"
          :aria-describedby="
            fieldErrors.name ? 'register-name-error register-name-hint' : 'register-name-hint'
          "
          class="mt-1.5 w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint"
          :class="fieldErrors.name ? 'border-fail' : 'border-rule'"
        />
        <p v-if="fieldErrors.name" id="register-name-error" class="mt-1.5 text-xs text-fail">
          {{ fieldErrors.name }}
        </p>
        <p id="register-name-hint" class="mt-1.5 text-xs text-muted">
          1 to <span class="tnum font-mono">{{ MAX_NAME_LENGTH }}</span> characters.
        </p>
      </div>

      <div>
        <label for="register-email" class="block text-sm font-medium text-ink">Email</label>
        <input
          id="register-email"
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
          :aria-describedby="
            fieldErrors.email ? 'register-email-error register-email-hint' : 'register-email-hint'
          "
          class="mt-1.5 w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint"
          :class="fieldErrors.email ? 'border-fail' : 'border-rule'"
        />
        <p v-if="fieldErrors.email" id="register-email-error" class="mt-1.5 text-xs text-fail">
          {{ fieldErrors.email }}
        </p>
        <p id="register-email-hint" class="mt-1.5 text-xs text-muted">
          You sign in with this. At most
          <span class="tnum font-mono">{{ MAX_EMAIL_LENGTH }}</span> characters.
        </p>
      </div>

      <PasswordField
        id="register-password"
        v-model="password"
        v-model:visible="passwordVisible"
        autocomplete="new-password"
        :minlength="MIN_PASSWORD_LENGTH"
        :maxlength="MAX_PASSWORD_LENGTH"
        :error="fieldErrors.password || ''"
      >
        <template #hint>
          <span class="tnum font-mono">{{ MIN_PASSWORD_LENGTH }}</span> to
          <span class="tnum font-mono">{{ MAX_PASSWORD_LENGTH }}</span> characters.
        </template>
      </PasswordField>

      <div>
        <label for="register-project" class="block text-sm font-medium text-ink">
          Project name
        </label>
        <input
          id="register-project"
          v-model="projectName"
          type="text"
          name="projectName"
          autocomplete="organization"
          required
          :maxlength="MAX_NAME_LENGTH"
          :aria-invalid="fieldErrors.projectName ? 'true' : undefined"
          :aria-describedby="
            fieldErrors.projectName
              ? 'register-project-error register-project-hint'
              : 'register-project-hint'
          "
          class="mt-1.5 w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint"
          :class="fieldErrors.projectName ? 'border-fail' : 'border-rule'"
        />
        <p
          v-if="fieldErrors.projectName"
          id="register-project-error"
          class="mt-1.5 text-xs text-fail"
        >
          {{ fieldErrors.projectName }}
        </p>
        <p id="register-project-hint" class="mt-1.5 text-xs text-muted">
          The project this account will own. 1 to
          <span class="tnum font-mono">{{ MAX_NAME_LENGTH }}</span> characters.
        </p>
      </div>

      <UiButton
        type="submit"
        variant="primary"
        class="w-full"
        :loading="submitting"
        :disabled="submitting"
      >
        {{ submitting ? 'Creating the account' : 'Create account' }}
      </UiButton>
    </form>

    <template #footer>
      <p>
        Already have an account?
        <RouterLink
          to="/login"
          class="text-ink underline decoration-rule underline-offset-4 hover:decoration-ink"
        >
          Sign in
        </RouterLink>
      </p>
    </template>
  </AuthLayout>
</template>
