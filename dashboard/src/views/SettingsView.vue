<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';
import AlertWebhookSection from '../components/AlertWebhookSection.vue';
import ApiKeysSection from '../components/ApiKeysSection.vue';
import SectionFrame from '../components/SectionFrame.vue';
import MembersSection from '../components/MembersSection.vue';
import ProjectNameSection from '../components/ProjectNameSection.vue';

const route = useRoute();
const auth = useAuthStore();

const projectId = computed(() => String(route.params.projectId));

const isOwner = computed(() => auth.roleIn(projectId.value) === 'OWNER');
</script>

<template>
  <div class="max-w-4xl space-y-8">
    <SectionFrame
      title="Settings"
      heading="Project settings"
      :description="
        isOwner
          ? ''
          : 'You are a member of this project. Renaming it, changing its alert address and managing members and API keys are owner actions, so those controls are not shown.'
      "
    />

    <ProjectNameSection :project-id="projectId" :is-owner="isOwner" />

    <div class="border-t border-rule pt-8">
      <AlertWebhookSection :project-id="projectId" :is-owner="isOwner" />
    </div>

    <div class="border-t border-rule pt-8">
      <MembersSection :project-id="projectId" :is-owner="isOwner" />
    </div>

    <div class="border-t border-rule pt-8">
      <ApiKeysSection :project-id="projectId" :is-owner="isOwner" />
    </div>
  </div>
</template>
