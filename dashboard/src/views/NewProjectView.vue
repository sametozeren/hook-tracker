<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';
import AuthLayout from '../components/AuthLayout.vue';
import ProjectCreateForm from '../components/ProjectCreateForm.vue';
import UiButton from '../components/ui/UiButton.vue';

const router = useRouter();
const auth = useAuthStore();

const hasProject = computed(() => auth.projects.length > 0);

const subtitle = computed(() =>
  hasProject.value
    ? 'Endpoints, API keys and deliveries belong to one project. This one starts empty.'
    : 'Your account is not a member of any project yet. Create one to start receiving events.',
);

async function onCreated(project) {
  await auth.loadMe();
  router.push({ name: 'deliveries', params: { projectId: project.id } });
}

function onCancel() {
  const first = auth.projects[0];

  if (first) {
    router.push({ name: 'deliveries', params: { projectId: first.id } });

    return;
  }

  router.push({ name: 'login' });
}

async function signOut() {
  await auth.logout();
  router.push({ name: 'login' });
}
</script>

<template>
  <AuthLayout title="New project" :subtitle="subtitle">
    <ProjectCreateForm @created="onCreated" @cancel="onCancel" />

    <template #footer>
      <p v-if="!hasProject">
        Signed in as {{ auth.user?.email }}.
        <UiButton variant="quiet" size="sm" @click="signOut">Sign out</UiButton>
      </p>
    </template>
  </AuthLayout>
</template>
